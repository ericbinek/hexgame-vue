/**
 * Buildings occupy exactly one triangle.
 *
 * A building exists exactly once as an entity; the occupied World cell only
 * references it via buildingId. The "footprint" is therefore trivially the
 * anchor triangle itself — earlier polyiamond shapes (strips, large triangles,
 * hexagon trading post) and rotation are deliberately dropped to keep
 * placement simple. `cells` stays an array (with exactly one entry) so that
 * World, Economy and rendering can keep working with sets of triangles
 * unchanged.
 */

import { triToHex } from './hex';
import { isBuildable, isMountain } from './terrain';
import type { TriCoord } from './tri';
import type { World } from './world';

export interface BuildingType {
  id: string;
  name: string;
  color: number;
  /** Terrain binding: 'mountain' = the cell must lie on a mountain hex. */
  terrain?: 'mountain';
}

export const BUILDING_TYPES: BuildingType[] = [
  { id: 'shed', name: 'Schuppen', color: 0x9c7e54 },
  { id: 'house', name: 'Wohnhaus', color: 0xc0563f },
  { id: 'sawmill', name: 'Sägewerk', color: 0x6f7d8c },
  { id: 'farm', name: 'Hof', color: 0xddc26a },
  { id: 'mill', name: 'Mühle', color: 0xb0a888 },
  { id: 'brewery', name: 'Brauerei', color: 0x7d5a9e },
  { id: 'bakery', name: 'Bäckerei', color: 0xc89b54 },
  { id: 'mine', name: 'Mine', color: 0x5a5f6b, terrain: 'mountain' },
  { id: 'smithy', name: 'Schmiede', color: 0x6b4a3f },
  { id: 'tradingPost', name: 'Kontor', color: 0xd9a441 },
];

export function typeById(id: string): BuildingType | undefined {
  return BUILDING_TYPES.find((t) => t.id === id);
}

/** Footprint of a building: the anchor triangle (every building occupies exactly one). */
export function footprintAt(anchor: TriCoord): TriCoord[] {
  return [{ x: anchor.x, y: anchor.y }];
}

export interface Building {
  id: number;
  typeId: string;
  z: number;
  cells: TriCoord[];
  /** Stock per good (managed by the Economy; for houses the food stock). */
  inv?: Record<string, number>;
  /** Upper bound of a workshop's output good; once reached → production stops. */
  maxOutput?: number;
  /** Per good of a trading post: min = export reserve, max = collection/storage limit. */
  limits?: Record<string, { min: number; max: number }>;
  /** Owner: undefined = player, otherwise the name of the NPC settlement. */
  owner?: string;
  /** Maintenance due: the workshop stands still until 1 wood arrives from the trading post. */
  needsMaintenance?: boolean;
}

export type RuleResult = { ok: true } | { ok: false; reason: string };

export class Buildings {
  readonly byId = new Map<number, Building>();
  private nextId = 1;

  constructor(private world: World) {}

  /**
   * Rules: ground floor only on buildable terrain (mines only on mountains);
   * upper floors need an occupied cell beneath every cell; cellars may only be
   * dug beneath buildings.
   */
  canPlace(cells: TriCoord[], z: number, type?: BuildingType): RuleResult {
    if (!this.world.inLimits(z)) return { ok: false, reason: 'außerhalb der Ebenen-Limits' };
    for (const c of cells) {
      if (this.world.get(c.x, c.y, z)) return { ok: false, reason: 'Fläche ist belegt' };
      if (z === 0) {
        const h = triToHex(c.x, c.y);
        if (!isBuildable(h.q, h.r)) return { ok: false, reason: 'auf Wasser nicht baubar' };
        if (type?.terrain === 'mountain' && !isMountain(h.q, h.r)) {
          return { ok: false, reason: 'nur auf Gebirge baubar' };
        }
      } else if (z > 0) {
        if (!this.world.get(c.x, c.y, z - 1)) return { ok: false, reason: 'keine tragende Ebene darunter' };
      } else {
        if (!this.world.get(c.x, c.y, z + 1)) return { ok: false, reason: 'Keller nur unter Gebäuden' };
      }
    }
    return { ok: true };
  }

  place(type: BuildingType, cells: TriCoord[], z: number, owner?: string): Building | null {
    if (!this.canPlace(cells, z, type).ok) return null;
    return this.placeUnchecked(type, cells, z, undefined, owner);
  }

  private placeUnchecked(type: BuildingType, cells: TriCoord[], z: number, id?: number, owner?: string): Building {
    const bid = id ?? this.nextId;
    this.nextId = Math.max(this.nextId, bid) + 1;
    const b: Building = { id: bid, typeId: type.id, z, cells: cells.map((c) => ({ ...c })), owner };
    this.byId.set(b.id, b);
    for (const c of b.cells) {
      this.world.set(c.x, c.y, z, { kind: type.name, color: type.color, buildingId: b.id });
    }
    return b;
  }

  at(x: number, y: number, z: number): Building | undefined {
    const id = this.world.get(x, y, z)?.buildingId;
    return id === undefined ? undefined : this.byId.get(id);
  }

  /** Demolition is forbidden as long as the building supports a layer above it. */
  removeAt(x: number, y: number, z: number): RuleResult {
    const b = this.at(x, y, z);
    if (!b) return { ok: false, reason: 'kein Gebäude an dieser Stelle' };
    for (const c of b.cells) {
      if (this.world.get(c.x, c.y, z + 1)?.buildingId !== undefined) {
        return { ok: false, reason: 'trägt eine Ebene darüber — erst oben abreißen' };
      }
    }
    for (const c of b.cells) this.world.remove(c.x, c.y, z);
    this.byId.delete(b.id);
    return { ok: true };
  }

  serialize(): string {
    const buildings = [...this.byId.values()].map((b) => ({
      id: b.id,
      t: b.typeId,
      z: b.z,
      cells: b.cells.map((c) => [c.x, c.y]),
      inv: b.inv && Object.keys(b.inv).length > 0 ? b.inv : undefined,
      mo: b.maxOutput,
      lim: b.limits && Object.keys(b.limits).length > 0 ? b.limits : undefined,
      o: b.owner,
      m: b.needsMaintenance ? 1 : undefined,
    }));
    return JSON.stringify({ v: 1, buildings });
  }

  /** Loads a saved game into an empty world. Unknown types are skipped. */
  restore(json: string): number {
    let loaded = 0;
    const data = JSON.parse(json) as {
      v: number;
      buildings: Array<{
        id?: number;
        t: string;
        z: number;
        cells: number[][];
        inv?: Record<string, number>;
        mo?: number;
        lim?: Record<string, { min: number; max: number }>;
        o?: string;
        m?: number;
      }>;
    };
    if (data.v !== 1 || !Array.isArray(data.buildings)) return 0;
    for (const e of data.buildings) {
      const type = typeById(e.t);
      if (!type || !this.world.inLimits(e.z)) continue;
      const cells = e.cells.map(([x, y]) => ({ x, y }));
      // IDs are preserved — trade routes reference trading posts by ID.
      const placed = this.placeUnchecked(type, cells, e.z, e.id, e.o);
      if (e.inv) placed.inv = { ...e.inv };
      if (e.mo !== undefined) placed.maxOutput = e.mo;
      if (e.lim) placed.limits = { ...e.lim };
      if (e.m) placed.needsMaintenance = true;
      loaded++;
    }
    return loaded;
  }
}
