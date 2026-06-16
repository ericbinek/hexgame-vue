import { describe, expect, it } from 'vitest';
import { World } from './world';

const BLOCK = { kind: 'block', color: 0xc97b4a };

describe('World (sparse Z-layer storage)', () => {
  it('set/get/remove across all layers, including negative coordinates', () => {
    const w = new World({ min: -3, max: 8 });
    expect(w.set(-4012, 873, -2, BLOCK)).toBe(true);
    expect(w.get(-4012, 873, -2)).toEqual(BLOCK);
    expect(w.get(-4012, 873, 0)).toBeUndefined(); // same XY, different layer
    expect(w.remove(-4012, 873, -2)).toBe(true);
    expect(w.get(-4012, 873, -2)).toBeUndefined();
    expect(w.size).toBe(0);
  });

  it('enforces the Z limits', () => {
    const w = new World({ min: -1, max: 2 });
    expect(w.set(0, 0, -2, BLOCK)).toBe(false);
    expect(w.set(0, 0, 3, BLOCK)).toBe(false);
    expect(w.set(0, 0, 2, BLOCK)).toBe(true);
    expect(w.size).toBe(1);
    expect(w.clampZ(99)).toBe(2);
    expect(w.clampZ(-99)).toBe(-1);
  });

  it('rejects invalid limits', () => {
    expect(() => new World({ min: 5, max: 1 })).toThrow();
  });

  it('cellsOnLayer returns only the cells of the requested layer', () => {
    const w = new World();
    w.set(1, 1, 0, BLOCK);
    w.set(2, 1, 0, BLOCK);
    w.set(1, 1, 1, BLOCK);
    expect([...w.cellsOnLayer(0)]).toHaveLength(2);
    expect([...w.cellsOnLayer(1)]).toHaveLength(1);
    expect([...w.cellsOnLayer(5)]).toHaveLength(0);
    expect(w.countOnLayer(0)).toBe(2);
  });

  it('overwrites instead of duplicating at the same coordinate', () => {
    const w = new World();
    w.set(3, 3, 0, BLOCK);
    w.set(3, 3, 0, { kind: 'lager', color: 0x123456 });
    expect(w.size).toBe(1);
    expect(w.get(3, 3, 0)?.kind).toBe('lager');
  });

  it('far-away coordinates cost nothing (sparse)', () => {
    const w = new World();
    w.set(10_000_000, -10_000_000, 8, BLOCK);
    expect(w.size).toBe(1);
    expect(w.get(10_000_000, -10_000_000, 8)).toEqual(BLOCK);
  });
});
