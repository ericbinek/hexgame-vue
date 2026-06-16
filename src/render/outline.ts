import { HALF, ROW_H, triVerticesFlat, type TriCoord } from '../core/tri';

/**
 * Outer edges of a set of triangles: edges used by only one cell. Inner edges
 * drop out — this gives a building a closed outline instead of a grid. Vertices
 * lie exactly on the grid (multiples of HALF/ROW_H), so rounded indices are
 * lossless as keys.
 */
export function boundaryEdges(cells: TriCoord[]): Array<[number, number, number, number]> {
  const edges = new Map<string, { edge: [number, number, number, number]; n: number }>();
  for (const c of cells) {
    const v = triVerticesFlat(c.x, c.y);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const a: [number, number] = [v[i * 2], v[i * 2 + 1]];
      const b: [number, number] = [v[j * 2], v[j * 2 + 1]];
      const ka = `${Math.round(a[0] / HALF)},${Math.round(a[1] / ROW_H)}`;
      const kb = `${Math.round(b[0] / HALF)},${Math.round(b[1] / ROW_H)}`;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const entry = edges.get(key);
      if (entry) entry.n++;
      else edges.set(key, { edge: [a[0], a[1], b[0], b[1]], n: 1 });
    }
  }
  return [...edges.values()].filter((e) => e.n === 1).map((e) => e.edge);
}
