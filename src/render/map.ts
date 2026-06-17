/**
 * Canvas 2D renderer for the terrain map. Draws the visible hexes directly
 * (immediate mode) in world coordinates — the camera transform (see
 * camera.applyToCanvas) maps them to the screen.
 *
 * LOD tiers and iteration are taken from original/src/render/chunks.ts; instead
 * of prebuilt Pixi graphics, it draws per frame (only when the camera has
 * moved). Chunk caching is the later optimization, if needed.
 */
import { RECIPES, ECON } from '../core/economy';
import type { Buildings } from '../core/buildings';
import { hexCenter, hexDistance, hexPolygonFlat, hexTriangles, triToHex, type HexCoord } from '../core/hex';
import { settlementTradingPosts } from '../core/npc';
import { ROUTE } from '../core/routes';
import { terrainAt, triShadeColor } from '../core/terrain';
import { ROW_H, SIDE, triCentroid, triVerticesFlat, type TriCoord } from '../core/tri';
import type { World } from '../core/world';
import { ghostFootprint } from '../game/actions';
import { buildingMapStatus, type MapStatusKind } from '../game/status';
import type { Store } from '../game/store';
import type { Camera } from './camera';
import { boundaryEdges } from './outline';

export type Tier = 0 | 1 | 2;

/** LOD by zoom (CSS-px per triangle side): 0 hex faces, 1 +outline, 2 triangles. */
export function tierForScale(scale: number): Tier {
  return scale >= 48 ? 2 : scale >= 16 ? 1 : 0;
}

function rawCssColor(n: number): string {
  return '#' + (n >>> 0).toString(16).padStart(6, '0');
}

// Small cache for the finite set of recurring colors (7 terrain types, building
// colors). Saves thousands of toString(16) allocations per frame. The tier-2
// shades are quasi-unbounded and deliberately not cached.
const colorCache = new Map<number, string>();
function cssColor(n: number): string {
  let s = colorCache.get(n);
  if (s === undefined) {
    s = rawCssColor(n);
    colorCache.set(n, s);
  }
  return s;
}

/** Sub-path (no beginPath) — to collect many polygons into one path. */
function addPoly(ctx: CanvasRenderingContext2D, flat: number[]): void {
  ctx.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  ctx.closePath();
}

function polyPath(ctx: CanvasRenderingContext2D, flat: number[]): void {
  ctx.beginPath();
  addPoly(ctx, flat);
}

function hexesInRadius(center: HexCoord, radius: number): HexCoord[] {
  const result: HexCoord[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const rMin = Math.max(-radius, -dq - radius);
    const rMax = Math.min(radius, -dq + radius);
    for (let dr = rMin; dr <= rMax; dr++) {
      result.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return result;
}

function drawHexRadius(
  ctx: CanvasRenderingContext2D,
  center: HexCoord,
  radius: number,
  fill: string,
  stroke: string,
  line: number,
): void {
  const hexes = hexesInRadius(center, radius);
  ctx.beginPath();
  for (const h of hexes) addPoly(ctx, hexPolygonFlat(h.q, h.r));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawWorldText(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  text: string,
  fill: string,
): void {
  const size = 12 / cam.scale;
  ctx.font = `${size}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3 / cam.scale;
  ctx.strokeStyle = 'rgba(8, 10, 14, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export function drawMap(ctx: CanvasRenderingContext2D, cam: Camera): void {
  const rect = cam.visibleRect();
  const tier = tierForScale(cam.scale);
  const line = 1 / cam.scale; // 1 CSS-px stroke, independent of zoom

  // Hexes in (a, b) space (a = q + r, b = q − r, a ≡ b mod 2).
  const aMin = Math.floor(rect.minX / (1.5 * SIDE)) - 1;
  const aMax = Math.ceil(rect.maxX / (1.5 * SIDE)) + 1;
  const bMin = Math.floor(rect.minY / ROW_H) - 1;
  const bMax = Math.ceil(rect.maxY / ROW_H) + 1;

  if (tier === 2) {
    // Zoomed in: each triangle has its own shade color (no batch win when
    // filling), but the outlines can be bundled into a single stroke.
    const outlines: number[][] = [];
    for (let a = aMin; a <= aMax; a++) {
      for (let b = bMin; b <= bMax; b++) {
        if (((a + b) & 1) !== 0) continue;
        const terrain = terrainAt((a + b) / 2, (a - b) / 2);
        for (const tri of hexTriangles((a + b) / 2, (a - b) / 2)) {
          const flat = triVerticesFlat(tri.x, tri.y);
          polyPath(ctx, flat);
          ctx.fillStyle = rawCssColor(triShadeColor(terrain.color, tri));
          ctx.fill();
          outlines.push(flat);
        }
      }
    }
    ctx.beginPath();
    for (const flat of outlines) addPoly(ctx, flat);
    ctx.lineWidth = line;
    ctx.strokeStyle = 'rgba(10, 14, 20, 0.25)';
    ctx.stroke();
    return;
  }

  // Tier 0/1: bundle hex faces by terrain color — instead of one fill() per hex,
  // a single collected path per color (≤ 7). At tier 1, all outlines in one stroke.
  const byColor = new Map<number, number[][]>();
  for (let a = aMin; a <= aMax; a++) {
    for (let b = bMin; b <= bMax; b++) {
      if (((a + b) & 1) !== 0) continue;
      const q = (a + b) / 2;
      const r = (a - b) / 2;
      const col = terrainAt(q, r).color;
      let arr = byColor.get(col);
      if (!arr) {
        arr = [];
        byColor.set(col, arr);
      }
      arr.push(hexPolygonFlat(q, r));
    }
  }

  for (const [col, polys] of byColor) {
    ctx.beginPath();
    for (const flat of polys) addPoly(ctx, flat);
    ctx.fillStyle = cssColor(col);
    ctx.fill();
  }

  if (tier === 1) {
    ctx.beginPath();
    for (const polys of byColor.values()) {
      for (const flat of polys) addPoly(ctx, flat);
    }
    ctx.lineWidth = line;
    ctx.strokeStyle = 'rgba(10, 14, 20, 0.3)';
    ctx.stroke();
  }
}

/**
 * Draw the buildings of the active Z-level over the terrain (cf.
 * scene.rebuildObjects): each cell in its building color, one closed outline per
 * building. The level below appears as a gray shadow.
 */
export function drawObjects(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  world: World,
  zLevel: number,
): void {
  const line = 1 / cam.scale;

  if (zLevel - 1 >= world.limits.min) {
    ctx.fillStyle = 'rgba(154, 160, 166, 0.35)';
    for (const e of world.cellsOnLayer(zLevel - 1)) {
      polyPath(ctx, triVerticesFlat(e.x, e.y));
      ctx.fill();
    }
  }

  const perBuilding = new Map<number, { color: number; cells: TriCoord[] }>();
  for (const e of world.cellsOnLayer(zLevel)) {
    const id = e.cell.buildingId ?? -1;
    let g = perBuilding.get(id);
    if (!g) {
      g = { color: e.cell.color, cells: [] };
      perBuilding.set(id, g);
    }
    g.cells.push({ x: e.x, y: e.y });
  }

  for (const g of perBuilding.values()) {
    ctx.fillStyle = cssColor(g.color);
    for (const c of g.cells) {
      polyPath(ctx, triVerticesFlat(c.x, c.y));
      ctx.fill();
    }
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of boundaryEdges(g.cells)) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.lineWidth = line;
    ctx.strokeStyle = 'rgba(20, 15, 10, 0.85)';
    ctx.stroke();
  }
}

/**
 * Settlement names above their trading posts — drawn in **screen space**, so
 * reset the canvas transform to device pixels before the call
 * (ctx.setTransform(dpr,0,0,dpr,0,0)). worldToScreen returns CSS pixels.
 */
export function drawLabels(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  buildings: Buildings,
): void {
  ctx.font = '13px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  for (const s of settlementTradingPosts(buildings)) {
    const k = buildings.byId.get(s.tradingPostId);
    if (!k) continue;
    const c = triCentroid(k.cells[0].x, k.cells[0].y);
    const p = cam.worldToScreen(c.x, c.y);
    const y = p.y - ROW_H * cam.scale - 4;
    ctx.strokeStyle = '#0a0e14';
    ctx.strokeText(s.name, p.x, y);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(s.name, p.x, y);
  }
}

function highlight(
  ctx: CanvasRenderingContext2D,
  t: TriCoord,
  tier: Tier,
  fill: string,
  stroke: string,
  line: number,
): void {
  const flat =
    tier === 2
      ? triVerticesFlat(t.x, t.y)
      : (() => {
          const h = triToHex(t.x, t.y);
          return hexPolygonFlat(h.q, h.r);
        })();
  polyPath(ctx, flat);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawBuildPlanning(ctx: CanvasRenderingContext2D, cam: Camera, store: Store): void {
  if (store.mode.kind !== 'build' || !store.hover) return;
  const hex = triToHex(store.hover.x, store.hover.y);
  const line = 1 / cam.scale;
  if (store.mode.type.id === 'tradingPost') {
    drawHexRadius(
      ctx,
      hex,
      ECON.tradingPostRadius,
      'rgba(85, 166, 255, 0.09)',
      'rgba(85, 166, 255, 0.28)',
      line,
    );
    const c = hexCenter(hex.q, hex.r);
    drawWorldText(ctx, cam, c.x, c.y + ROW_H * (ECON.tradingPostRadius + 1.4), 'Kontor-Reichweite', '#9dccff');
  } else if (RECIPES[store.mode.type.id]) {
    drawHexRadius(
      ctx,
      hex,
      ECON.workerRadius,
      'rgba(255, 209, 102, 0.10)',
      'rgba(255, 209, 102, 0.34)',
      line,
    );
    const c = hexCenter(hex.q, hex.r);
    drawWorldText(ctx, cam, c.x, c.y + ROW_H * (ECON.workerRadius + 1.3), 'Arbeiter-Reichweite', '#ffd166');
  }
}

function drawRoutePlanning(ctx: CanvasRenderingContext2D, cam: Camera, store: Store): void {
  if (store.mode.kind !== 'route') return;
  const line = 2 / cam.scale;
  if (store.mode.fromId === null) {
    ctx.lineWidth = line;
    ctx.strokeStyle = 'rgba(105, 219, 124, 0.8)';
    for (const b of store.buildings.byId.values()) {
      if (b.typeId !== 'tradingPost' || b.z !== store.zLevel) continue;
      polyPath(ctx, triVerticesFlat(b.cells[0].x, b.cells[0].y));
      ctx.stroke();
    }
    return;
  }

  const from = store.buildings.byId.get(store.mode.fromId);
  if (!from || from.typeId !== 'tradingPost' || !store.hover) return;
  const target = store.buildings.at(store.hover.x, store.hover.y, store.zLevel);
  const fromCenter = triCentroid(from.cells[0].x, from.cells[0].y);
  const toCell = target?.typeId === 'tradingPost' ? target.cells[0] : store.hover;
  const toCenter = triCentroid(toCell.x, toCell.y);

  ctx.beginPath();
  ctx.moveTo(fromCenter.x, fromCenter.y);
  ctx.lineTo(toCenter.x, toCenter.y);
  ctx.lineWidth = line;
  ctx.strokeStyle = target?.typeId === 'tradingPost' ? 'rgba(105, 219, 124, 0.9)' : 'rgba(255, 209, 102, 0.7)';
  ctx.stroke();

  const a = triToHex(from.cells[0].x, from.cells[0].y);
  const b = triToHex(toCell.x, toCell.y);
  const distance = hexDistance(a, b);
  const ticks = Math.max(1, Math.ceil(distance / ROUTE.hexPerTick));
  const label = target?.typeId === 'tradingPost' ? `${distance} Hex · ${ticks} Ticks` : `${distance} Hex`;
  drawWorldText(ctx, cam, (fromCenter.x + toCenter.x) / 2, (fromCenter.y + toCenter.y) / 2, label, '#d9f99d');
}

const STATUS_COLORS: Record<MapStatusKind, string> = {
  maintenance: '#ff8787',
  workers: '#91c8ff',
  input: '#ffd166',
  output: '#f59f00',
  storage: '#d8b4fe',
};

const BUILDING_MARKS: Record<string, string> = {
  tradingPost: 'K',
  house: 'W',
  sawmill: 'S',
  farm: 'H',
  mill: 'M',
  brewery: 'Br',
  bakery: 'Bk',
  mine: 'Mi',
  smithy: 'Sm',
  shed: 'L',
};

function drawBuildingTypeMarkers(ctx: CanvasRenderingContext2D, cam: Camera, store: Store): void {
  if (cam.scale < 36) return;
  for (const b of store.buildings.byId.values()) {
    if (b.z !== store.zLevel) continue;
    const mark = BUILDING_MARKS[b.typeId];
    if (!mark) continue;
    const c = triCentroid(b.cells[0].x, b.cells[0].y);
    const s = Math.max(0.2, mark.length * 0.11 + 0.18);
    ctx.fillStyle = b.owner === undefined ? 'rgba(8, 10, 14, 0.58)' : 'rgba(8, 10, 14, 0.42)';
    ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s);
    ctx.lineWidth = 1 / cam.scale;
    ctx.strokeStyle = b.owner === undefined ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 233, 168, 0.45)';
    ctx.strokeRect(c.x - s / 2, c.y - s / 2, s, s);
    drawWorldText(ctx, cam, c.x, c.y, mark, b.owner === undefined ? '#f8fafc' : '#ffe9a8');
  }
}

function drawStatusBadges(ctx: CanvasRenderingContext2D, cam: Camera, store: Store): void {
  if (cam.scale < 24) return;
  for (const b of store.buildings.byId.values()) {
    if (b.z !== store.zLevel) continue;
    const status = buildingMapStatus(store, b);
    if (!status) continue;
    const c = triCentroid(b.cells[0].x, b.cells[0].y);
    const color = STATUS_COLORS[status.kind];
    const w = Math.max(0.78, status.label.length * 0.16 + 0.36);
    const h = 0.28;
    const y = c.y + 0.42;
    ctx.fillStyle = 'rgba(8, 10, 14, 0.82)';
    ctx.fillRect(c.x - w / 2, y - h / 2, w, h);
    ctx.lineWidth = 1.5 / cam.scale;
    ctx.strokeStyle = color;
    ctx.strokeRect(c.x - w / 2, y - h / 2, w, h);
    drawWorldText(ctx, cam, c.x, y, status.label, color);
  }
}

/**
 * Interaction overlay: in build mode, the preview (green = buildable, red = not)
 * at the cursor, otherwise selection (yellow) and hover (white) highlights. Cf.
 * scene.redrawOverlay.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, cam: Camera, store: Store): void {
  const line = 1 / cam.scale;

  drawBuildPlanning(ctx, cam, store);
  drawRoutePlanning(ctx, cam, store);
  drawBuildingTypeMarkers(ctx, cam, store);
  drawStatusBadges(ctx, cam, store);

  const ghost = ghostFootprint(store);
  if (ghost) {
    ctx.fillStyle = ghost.ok ? 'rgba(105, 219, 124, 0.35)' : 'rgba(255, 107, 107, 0.35)';
    for (const c of ghost.cells) {
      polyPath(ctx, triVerticesFlat(c.x, c.y));
      ctx.fill();
    }
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of boundaryEdges(ghost.cells)) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.lineWidth = line;
    ctx.strokeStyle = ghost.ok ? '#69db7c' : '#ff6b6b';
    ctx.stroke();
    if (!ghost.ok && ghost.reason) {
      const c = triCentroid(ghost.cells[0].x, ghost.cells[0].y);
      drawWorldText(ctx, cam, c.x, c.y + 0.55, ghost.reason, '#ffb4b4');
    }
    return;
  }

  const tier = tierForScale(cam.scale);
  if (store.selected) {
    highlight(ctx, store.selected, tier, 'rgba(255, 209, 102, 0.18)', '#ffd166', line);
  }
  if (store.hover) {
    highlight(ctx, store.hover, tier, 'rgba(255, 255, 255, 0.10)', 'rgba(255, 255, 255, 0.6)', line);
  }
}
