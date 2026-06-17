import { describe, expect, it } from 'vitest';
import { Buildings, footprintAt, typeById } from './buildings';
import { triToHex } from './hex';
import { isBuildable, isMountain } from './terrain';
import type { TriCoord } from './tri';
import { World } from './world';

const house = typeById('house')!;
const shed = typeById('shed')!;
const sawmill = typeById('sawmill')!;

/** Finds an anchor where building is possible on the ground floor (terrain is deterministic). */
function findLandAnchor(b: Buildings): TriCoord {
  for (let y = -120; y <= 120; y++) {
    for (let x = -120; x <= 120; x++) {
      if (b.canPlace(footprintAt({ x, y }), 0).ok) return { x, y };
    }
  }
  throw new Error('kein Bauplatz im Suchbereich');
}

function findWaterTri(): TriCoord {
  for (let y = -120; y <= 120; y++) {
    for (let x = -120; x <= 120; x++) {
      const h = triToHex(x, y);
      if (!isBuildable(h.q, h.r)) return { x, y };
    }
  }
  throw new Error('kein Wasser im Suchbereich');
}

describe('Footprints', () => {
  it('footprintAt returns exactly the anchor triangle (every building = one triangle)', () => {
    const cells = footprintAt({ x: 3, y: 1 });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ x: 3, y: 1 });
  });
});

describe('Placement rules', () => {
  it('places on land, refuses water and collisions', () => {
    const world = new World();
    const b = new Buildings(world);
    const anchor = findLandAnchor(b);

    const placed = b.place(house, footprintAt(anchor), 0);
    expect(placed).not.toBeNull();
    expect(placed!.cells).toHaveLength(1);
    expect(world.get(anchor.x, anchor.y, 0)?.buildingId).toBe(placed!.id);
    expect(b.at(anchor.x, anchor.y, 0)?.id).toBe(placed!.id);

    expect(b.canPlace(footprintAt(anchor), 0)).toEqual({ ok: false, reason: 'Fläche ist belegt' });

    const water = findWaterTri();
    expect(b.canPlace(footprintAt(water), 0).ok).toBe(false);
  });

  it('upper floors need support, cellars need a building above', () => {
    const world = new World();
    const b = new Buildings(world);
    const anchor = findLandAnchor(b);
    b.place(house, footprintAt(anchor), 0);
    const empty = { x: anchor.x + 50, y: anchor.y };

    // Upper floor 1 on the house: ok. Upper floor 2 above it: ok (floor 1 supports). Floating: no.
    expect(b.place(shed, footprintAt(anchor), 1)).not.toBeNull();
    expect(b.canPlace(footprintAt(anchor), 2).ok).toBe(true);
    expect(b.canPlace(footprintAt(empty), 1).ok).toBe(false);

    // Cellar beneath the building: ok. Beneath an empty field: no.
    expect(b.canPlace(footprintAt(anchor), -1).ok).toBe(true);
    expect(b.canPlace(footprintAt(empty), -1).ok).toBe(false);
  });

  it('demolition is blocked as long as a layer above is supported', () => {
    const world = new World();
    const b = new Buildings(world);
    const anchor = findLandAnchor(b);
    b.place(house, footprintAt(anchor), 0);
    b.place(shed, footprintAt(anchor), 1);

    expect(b.removeAt(anchor.x, anchor.y, 0).ok).toBe(false);
    expect(b.removeAt(anchor.x, anchor.y, 1).ok).toBe(true);
    expect(b.removeAt(anchor.x, anchor.y, 0).ok).toBe(true);
    expect(world.get(anchor.x, anchor.y, 0)).toBeUndefined();
    expect(b.byId.size).toBe(0);
  });
});

describe('Terrain binding', () => {
  it('mine only on mountains', () => {
    const world = new World();
    const b = new Buildings(world);
    const mine = typeById('mine')!;
    let mineSpot: TriCoord | null = null;
    let grassSpot: TriCoord | null = null;
    for (let y = -150; y <= 150 && (!mineSpot || !grassSpot); y++) {
      for (let x = -150; x <= 150 && (!mineSpot || !grassSpot); x++) {
        const h = triToHex(x, y);
        if (!mineSpot && isMountain(h.q, h.r) && b.canPlace(footprintAt({ x, y }), 0, mine).ok) {
          mineSpot = { x, y };
        }
        if (!grassSpot && isBuildable(h.q, h.r) && !isMountain(h.q, h.r)) {
          grassSpot = { x, y };
        }
      }
    }
    expect(mineSpot, 'kein Gebirgs-Bauplatz im Suchbereich').not.toBeNull();
    expect(grassSpot).not.toBeNull();
    expect(b.canPlace(footprintAt(grassSpot!), 0, mine).ok).toBe(false);
    expect(b.place(mine, footprintAt(mineSpot!), 0)).not.toBeNull();
  });
});

describe('Serialization', () => {
  it('serialize/restore preserves buildings and occupancy', () => {
    const world = new World();
    const b = new Buildings(world);
    const anchor = findLandAnchor(b);
    b.place(house, footprintAt(anchor), 0);
    b.place(shed, footprintAt(anchor), 1);

    const world2 = new World();
    const b2 = new Buildings(world2);
    expect(b2.restore(b.serialize())).toBe(2);
    expect(b2.byId.size).toBe(2);
    expect(world2.get(anchor.x, anchor.y, 0)?.kind).toBe('Wohnhaus');
    expect(world2.get(anchor.x, anchor.y, 1)?.kind).toBe('Schuppen');
  });

  it('serialize/restore preserves manual worker targets', () => {
    const world = new World();
    const b = new Buildings(world);
    const anchor = findLandAnchor(b);
    const placed = b.place(sawmill, footprintAt(anchor), 0)!;
    placed.workerTarget = 1;

    const world2 = new World();
    const b2 = new Buildings(world2);
    expect(b2.restore(b.serialize())).toBe(1);
    expect([...b2.byId.values()][0].workerTarget).toBe(1);
  });
});
