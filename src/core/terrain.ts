/**
 * Deterministic placeholder terrain: one terrain type per hex field from a
 * coordinate hash. No randomness, no state — the same coordinate always
 * yields the same terrain, without anything having to be saved or
 * "loaded".
 */

import type { TriCoord } from './tri';

function hash2(q: number, r: number, seed = 0): number {
  let h = Math.imul(q, 374761393) ^ Math.imul(r, 668265263) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinearly interpolated value noise over the axial coordinates. */
function valueNoise(q: number, r: number, cell: number, seed: number): number {
  const qf = q / cell;
  const rf = r / cell;
  const q0 = Math.floor(qf);
  const r0 = Math.floor(rf);
  const tq = smoothstep(qf - q0);
  const tr = smoothstep(rf - r0);
  const a = hash2(q0, r0, seed);
  const b = hash2(q0 + 1, r0, seed);
  const c = hash2(q0, r0 + 1, seed);
  const d = hash2(q0 + 1, r0 + 1, seed);
  return (a * (1 - tq) + b * tq) * (1 - tr) + (c * (1 - tq) + d * tq) * tr;
}

export function elevation(q: number, r: number): number {
  return (
    0.55 * valueNoise(q, r, 9, 7) +
    0.30 * valueNoise(q, r, 3, 3) +
    0.15 * hash2(q, r, 1)
  );
}

export interface Terrain {
  name: string;
  color: number;
}

/** Everything from beach height upward is buildable — water is not. */
export function isBuildable(q: number, r: number): boolean {
  return elevation(q, r) >= 0.45;
}

/** Mountain — prerequisite for mines. */
export function isMountain(q: number, r: number): boolean {
  return elevation(q, r) >= 0.78;
}

export function terrainAt(q: number, r: number): Terrain {
  const e = elevation(q, r);
  if (e < 0.38) return { name: 'Tiefes Wasser', color: 0x1d3f6e };
  if (e < 0.45) return { name: 'Küstenwasser', color: 0x2b6ca3 };
  if (e < 0.48) return { name: 'Strand', color: 0xcdbb7d };
  if (e < 0.60) return { name: 'Grasland', color: 0x7aa84f };
  if (e < 0.70) return { name: 'Wald', color: 0x4d7a3a };
  if (e < 0.78) return { name: 'Hügel', color: 0x9a8f6e };
  return { name: 'Gebirge', color: 0xb3b3bc };
}

/** Slight brightness variation per triangle so the subdivision becomes visible. */
export function triShadeColor(base: number, tri: TriCoord): number {
  const f = 0.93 + 0.14 * hash2(tri.x, tri.y, 99);
  const r = Math.min(255, Math.round(((base >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((base >> 8) & 255) * f));
  const b = Math.min(255, Math.round((base & 255) * f));
  return (r << 16) | (g << 8) | b;
}
