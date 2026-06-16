/**
 * Sparse world state over (x, y, z): triangle coordinate plus vertical layer
 * (z < 0 = cellar/bunker, 0 = ground floor, z > 0 = upper floors).
 *
 * Objects exist as entries per coordinate — an empty map costs nothing,
 * and nothing has to be "loaded" in order to exist. The layer limits are
 * configurable (like build limits in Minecraft).
 */

export interface ZLimits {
  min: number;
  max: number;
}

export interface Cell {
  kind: string;
  color: number;
  buildingId?: number;
}

export interface CellEntry {
  x: number;
  y: number;
  cell: Cell;
}

export class World {
  readonly limits: ZLimits;
  private layers = new Map<number, Map<string, CellEntry>>();

  constructor(limits: ZLimits = { min: -3, max: 8 }) {
    if (limits.min > limits.max) {
      throw new Error(`Ungültige Z-Limits: min ${limits.min} > max ${limits.max}`);
    }
    this.limits = limits;
  }

  inLimits(z: number): boolean {
    return Number.isInteger(z) && z >= this.limits.min && z <= this.limits.max;
  }

  clampZ(z: number): number {
    return Math.min(this.limits.max, Math.max(this.limits.min, z));
  }

  /** Sets a cell. Returns false if z lies outside the limits. */
  set(x: number, y: number, z: number, cell: Cell): boolean {
    if (!this.inLimits(z)) return false;
    let layer = this.layers.get(z);
    if (!layer) {
      layer = new Map();
      this.layers.set(z, layer);
    }
    layer.set(`${x},${y}`, { x, y, cell });
    return true;
  }

  get(x: number, y: number, z: number): Cell | undefined {
    return this.layers.get(z)?.get(`${x},${y}`)?.cell;
  }

  remove(x: number, y: number, z: number): boolean {
    const layer = this.layers.get(z);
    if (!layer) return false;
    const removed = layer.delete(`${x},${y}`);
    if (layer.size === 0) this.layers.delete(z);
    return removed;
  }

  cellsOnLayer(z: number): IterableIterator<CellEntry> {
    return (this.layers.get(z) ?? new Map<string, CellEntry>()).values();
  }

  countOnLayer(z: number): number {
    return this.layers.get(z)?.size ?? 0;
  }

  get size(): number {
    let n = 0;
    for (const layer of this.layers.values()) n += layer.size;
    return n;
  }
}
