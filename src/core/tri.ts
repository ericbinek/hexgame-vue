/**
 * Triangle grid — the map's fundamental coordinate system.
 *
 * Every cell is an equilateral triangle with coordinate (x, y), x/y ∈ ℤ.
 * Orientation follows the parity rule: (x + y) even → ▲, odd → ▽.
 * Hexagons are groupings of 6 triangles (see hex.ts), not a separate truth.
 */

export const SIDE = 1;
export const HALF = SIDE / 2;
export const ROW_H = (Math.sqrt(3) / 2) * SIDE;

export interface TriCoord {
  x: number;
  y: number;
}

export function isUp(x: number, y: number): boolean {
  return (((x + y) % 2) + 2) % 2 === 0;
}

/** Vertices as a flat array [x1,y1, x2,y2, x3,y3] in world coordinates (y-axis pointing up). */
export function triVerticesFlat(x: number, y: number): number[] {
  const left = x * HALF;
  const bottom = y * ROW_H;
  const top = bottom + ROW_H;
  return isUp(x, y)
    ? [left, bottom, left + SIDE, bottom, left + HALF, top]
    : [left + HALF, bottom, left + SIDE, top, left, top];
}

export function triCentroid(x: number, y: number): { x: number; y: number } {
  const v = triVerticesFlat(x, y);
  return { x: (v[0] + v[2] + v[4]) / 3, y: (v[1] + v[3] + v[5]) / 3 };
}

/**
 * The 3 edge neighbors. ▲ has its horizontal edge at the bottom (neighbor y−1),
 * ▽ has it at the top (neighbor y+1).
 */
export function neighbors(x: number, y: number): TriCoord[] {
  return isUp(x, y)
    ? [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }]
    : [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y + 1 }];
}

export function containsPoint(x: number, y: number, wx: number, wy: number): boolean {
  const u = (wx - x * HALF) / SIDE;
  const v = wy / ROW_H - y;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const d = Math.abs(2 * u - 1);
  return isUp(x, y) ? v <= 1 - d + 1e-9 : v >= d - 1e-9;
}

/** World point → triangle coordinate (for mouse/touch picking). */
export function pointToTri(wx: number, wy: number): TriCoord {
  const y = Math.floor(wy / ROW_H);
  const g = Math.floor(wx / HALF);
  for (const x of [g - 2, g - 1, g]) {
    if (containsPoint(x, y, wx, wy)) return { x, y };
  }
  return { x: g - 1, y }; // numeric edge case landing exactly on an edge
}
