/**
 * Hexagons as an aggregation of 6 triangles.
 *
 * A hexagon (q, r) is centered on the grid vertex (k, m), with
 * k = 3(q + r) and m = q − r. Grid vertices lie at (k·HALF, m·ROW_H)
 * with k + m even; exactly every vertex with k ≡ 0 (mod 3) is a hex center,
 * and every triangle has exactly one such corner → unique assignment.
 */

import { HALF, ROW_H, SIDE, type TriCoord } from './tri';

export interface HexCoord {
  q: number;
  r: number;
}

export function hexCenter(q: number, r: number): { x: number; y: number } {
  return { x: 1.5 * SIDE * (q + r), y: (q - r) * ROW_H };
}

/** Distance in hex fields (standard axial distance). */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** The 6 triangles of a hexagon: top row ▲▽▲, bottom row ▽▲▽. */
export function hexTriangles(q: number, r: number): TriCoord[] {
  const k = 3 * (q + r);
  const m = q - r;
  return [
    { x: k - 2, y: m },
    { x: k - 1, y: m },
    { x: k, y: m },
    { x: k - 2, y: m - 1 },
    { x: k - 1, y: m - 1 },
    { x: k, y: m - 1 },
  ];
}

/** Outline as a flat array for rendering. */
export function hexPolygonFlat(q: number, r: number): number[] {
  const k = 3 * (q + r);
  const m = q - r;
  const ring = [
    [k + 2, m],
    [k + 1, m + 1],
    [k - 1, m + 1],
    [k - 2, m],
    [k - 1, m - 1],
    [k + 1, m - 1],
  ];
  return ring.flatMap(([kk, mm]) => [kk * HALF, mm * ROW_H]);
}

/** Triangle → its hexagon (the one corner with k ≡ 0 mod 3 is the center). */
export function triToHex(x: number, y: number): HexCoord {
  const up = (((x + y) % 2) + 2) % 2 === 0;
  const corners: Array<[number, number]> = up
    ? [[x, y], [x + 2, y], [x + 1, y + 1]]
    : [[x + 1, y], [x + 2, y + 1], [x, y + 1]];
  for (const [k, m] of corners) {
    if (((k % 3) + 3) % 3 === 0) {
      const t = k / 3;
      return { q: (t + m) / 2, r: (t - m) / 2 };
    }
  }
  throw new Error(`triToHex: no hex center for (${x}, ${y}) — invariant violated`);
}
