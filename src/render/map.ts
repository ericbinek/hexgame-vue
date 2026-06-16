/**
 * Canvas 2D renderer for the terrain map. Draws the visible hexes directly
 * (immediate mode) in world coordinates — the camera transform (see
 * camera.applyToCanvas) maps them to the screen.
 *
 * LOD tiers and iteration are taken from original/src/render/chunks.ts; instead
 * of prebuilt Pixi graphics, it draws per frame (only when the camera has
 * moved). Chunk caching is the later optimization, if needed.
 */
import type { Buildings } from '../core/buildings';
import { hexPolygonFlat, hexTriangles, triToHex } from '../core/hex';
import { settlementTradingPosts } from '../core/npc';
import { terrainAt, triShadeColor } from '../core/terrain';
import { ROW_H, SIDE, triCentroid, triVerticesFlat, type TriCoord } from '../core/tri';
import type { World } from '../core/world';
import { ghostFootprint } from '../game/actions';
import type { Store } from '../game/store';
import type { Camera } from './camera';
import { boundaryEdges } from './outline';

export type Tier = 0 | 1 | 2;

/** LOD by zoom (CSS-px per triangle side): 0 hex faces, 1 +outline, 2 triangles. */
export function tierForScale(scale: number): Tier {
  return scale >= 48 ? 2 : scale >= 16 ? 1 : 0;
}

function cssColor(n: number): string {
  return '#' + (n >>> 0).toString(16).padStart(6, '0');
}

function polyPath(ctx: CanvasRenderingContext2D, flat: number[]): void {
  ctx.beginPath();
  ctx.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  ctx.closePath();
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

  for (let a = aMin; a <= aMax; a++) {
    for (let b = bMin; b <= bMax; b++) {
      if (((a + b) & 1) !== 0) continue;
      const q = (a + b) / 2;
      const r = (a - b) / 2;
      const terrain = terrainAt(q, r);

      if (tier === 2) {
        for (const tri of hexTriangles(q, r)) {
          polyPath(ctx, triVerticesFlat(tri.x, tri.y));
          ctx.fillStyle = cssColor(triShadeColor(terrain.color, tri));
          ctx.fill();
          ctx.lineWidth = line;
          ctx.strokeStyle = 'rgba(10, 14, 20, 0.25)';
          ctx.stroke();
        }
      } else {
        polyPath(ctx, hexPolygonFlat(q, r));
        ctx.fillStyle = cssColor(terrain.color);
        ctx.fill();
        if (tier === 1) {
          ctx.lineWidth = line;
          ctx.strokeStyle = 'rgba(10, 14, 20, 0.3)';
          ctx.stroke();
        }
      }
    }
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

/**
 * Interaction overlay: in build mode, the preview (green = buildable, red = not)
 * at the cursor, otherwise selection (yellow) and hover (white) highlights. Cf.
 * scene.redrawOverlay.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, cam: Camera, store: Store): void {
  const line = 1 / cam.scale;

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
