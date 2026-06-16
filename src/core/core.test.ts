import { describe, expect, it } from 'vitest';
import {
  containsPoint,
  isUp,
  neighbors,
  pointToTri,
  triCentroid,
  triVerticesFlat,
} from './tri';
import { hexTriangles, triToHex } from './hex';

describe('Parity rule', () => {
  it('determines orientation from (x+y) mod 2, including for negative coordinates', () => {
    expect(isUp(0, 0)).toBe(true);
    expect(isUp(1, 0)).toBe(false);
    expect(isUp(0, 1)).toBe(false);
    expect(isUp(1, 1)).toBe(true);
    expect(isUp(-1, 0)).toBe(false);
    expect(isUp(-1, -1)).toBe(true);
    expect(isUp(-2, 5)).toBe(false);
  });
});

describe('Neighborhood', () => {
  it('every triangle has exactly 3 neighbors and the relation is symmetric', () => {
    for (let x = -4; x <= 4; x++) {
      for (let y = -4; y <= 4; y++) {
        const ns = neighbors(x, y);
        expect(ns).toHaveLength(3);
        for (const n of ns) {
          const back = neighbors(n.x, n.y);
          expect(back).toContainEqual({ x, y });
        }
      }
    }
  });

  it('neighbors always have opposite orientation', () => {
    for (let x = -4; x <= 4; x++) {
      for (let y = -4; y <= 4; y++) {
        for (const n of neighbors(x, y)) {
          expect(isUp(n.x, n.y)).toBe(!isUp(x, y));
        }
      }
    }
  });
});

describe('Geometry', () => {
  it('horizontal neighbors share exactly one edge (2 vertices)', () => {
    const a = triVerticesFlat(0, 0);
    const b = triVerticesFlat(1, 0);
    const pts = (v: number[]) => [`${v[0]},${v[1]}`, `${v[2]},${v[3]}`, `${v[4]},${v[5]}`];
    const shared = pts(a).filter((p) => pts(b).includes(p));
    expect(shared).toHaveLength(2);
  });

  it('the centroid of a triangle lies within the triangle itself', () => {
    for (let x = -6; x <= 6; x++) {
      for (let y = -6; y <= 6; y++) {
        const c = triCentroid(x, y);
        expect(containsPoint(x, y, c.x, c.y)).toBe(true);
      }
    }
  });

  it('pointToTri is the inverse of triCentroid (picking roundtrip)', () => {
    for (let x = -6; x <= 6; x++) {
      for (let y = -6; y <= 6; y++) {
        const c = triCentroid(x, y);
        expect(pointToTri(c.x, c.y)).toEqual({ x, y });
      }
    }
  });
});

describe('Hex aggregation', () => {
  it('triToHex is the inverse of hexTriangles', () => {
    for (let q = -4; q <= 4; q++) {
      for (let r = -4; r <= 4; r++) {
        for (const t of hexTriangles(q, r)) {
          expect(triToHex(t.x, t.y)).toEqual({ q, r });
        }
      }
    }
  });

  it('hexagons do not overlap — every triangle belongs to exactly one hex', () => {
    const seen = new Set<string>();
    for (let q = -4; q <= 4; q++) {
      for (let r = -4; r <= 4; r++) {
        for (const t of hexTriangles(q, r)) {
          const key = `${t.x},${t.y}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
    expect(seen.size).toBe(9 * 9 * 6);
  });

  it('any arbitrary triangle lands in a hex whose 6 triangles contain it', () => {
    for (let x = -10; x <= 10; x++) {
      for (let y = -10; y <= 10; y++) {
        const h = triToHex(x, y);
        const members = hexTriangles(h.q, h.r);
        expect(members).toContainEqual({ x, y });
      }
    }
  });
});
