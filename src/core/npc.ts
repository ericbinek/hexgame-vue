/**
 * NPC settlements: autonomous towns with name and specialization. They consist
 * of normal buildings with a set `owner` — the Economy runs each owner as its
 * own cycle, exchange happens only via trade routes (for money, see routes.ts).
 *
 * Placement is deterministic: target points around the origin, then a spiral
 * search for valid build spots using the normal placement rules.
 */

import { footprintAt, typeById, type Buildings } from './buildings';
import { stockOf } from './economy';
import { triToHex } from './hex';
import { isBuildable } from './terrain';
import type { TriCoord } from './tri';

interface SettlementSpec {
  name: string;
  /** Workshops next to the trading post and the houses. */
  extras: string[];
  /** Starting goods in the trading post. */
  startInv: Record<string, number>;
  /** Settles at the nearest mountain and runs a mine there (for ore villages). */
  atMountain?: boolean;
  /** Number of houses (default 3) — more for workshop-rich villages. */
  houses?: number;
}

const SPECS: SettlementSpec[] = [
  // Each village is self-supplied: sawmill (wood for maintenance) and the
  // three-stage food chain farm (grain) → mill (flour) → bakery (bread) —
  // otherwise, without a wood source, maintenance runs out or the houses starve.
  // A flour starting buffer bridges the ramp-up of the longer chain. Enough houses
  // for the worker balance (one bread-supplied house provides 2 workers, 2 per workshop;
  // the additional mill itself needs 2 → one house more than before).
  { name: 'Eldwik', extras: ['sawmill', 'farm', 'mill', 'bakery', 'brewery'], startInv: { bread: 16, beer: 12, flour: 8, grain: 6, wood: 12 }, houses: 5 },
  { name: 'Tornquist', extras: ['sawmill', 'farm', 'mill', 'bakery'], startInv: { bread: 14, flour: 8, grain: 12, wood: 12 }, houses: 4 },
  { name: 'Salzholm', extras: ['sawmill', 'farm', 'mill', 'bakery'], startInv: { bread: 14, flour: 8, wood: 16, grain: 4 }, houses: 4 },
  // Ore village: mine (ore, at the mountain) + smithy (ore+wood→tools), plus the
  // basic supply. Sells the expensive tools. Lies far out at the mountain.
  { name: 'Erzgrund', extras: ['sawmill', 'farm', 'mill', 'bakery', 'smithy'], startInv: { bread: 14, flour: 8, wood: 12, ore: 6, tools: 4 }, atMountain: true, houses: 6 },
];

/**
 * Enough land in the neighborhood? Prevents settlements on sandbanks:
 * at least 16 of the 19 hex tiles within radius 2 must be buildable.
 */
function hasLandAround(anchor: TriCoord): boolean {
  const h = triToHex(anchor.x, anchor.y);
  let land = 0;
  for (let dq = -2; dq <= 2; dq++) {
    for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr++) {
      if (isBuildable(h.q + dq, h.r + dr)) land++;
    }
  }
  return land >= 16;
}

/** Searches ring by ring from `near` for the first valid build spot for the type. */
function findSpot(
  buildings: Buildings,
  typeId: string,
  near: TriCoord,
  maxRing: number,
  needLandAround = false,
): TriCoord[] | null {
  const type = typeById(typeId);
  if (!type) return null;
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (const dy of ring === 0 ? [0] : [-ring, ring]) {
        for (const d of [{ dx, dy }, { dx: dy, dy: dx }]) {
          const anchor = { x: near.x + d.dx, y: near.y + d.dy };
          if (needLandAround && !hasLandAround(anchor)) continue;
          const cells = footprintAt(anchor);
          // Pass the type so the terrain binding (mine only on mountain) applies.
          if (buildings.canPlace(cells, 0, type).ok) return cells;
        }
      }
    }
  }
  return null;
}

/**
 * Retrofits a missing mill into existing settlements. Since the bread chain is
 * three-stage (farm → mill → bakery), a village from an old save starves whose
 * bakery no longer gets flour without a mill. Idempotent: settlements that
 * already have a mill (or no bakery at all) stay untouched. Returns the names
 * of the retrofitted settlements.
 */
function retrofitMills(buildings: Buildings): string[] {
  const owners = new Set<string>();
  for (const b of buildings.byId.values()) {
    if (b.owner !== undefined) owners.add(b.owner);
  }
  const changed: string[] = [];
  for (const owner of owners) {
    const members = [...buildings.byId.values()].filter((b) => b.owner === owner);
    if (!members.some((b) => b.typeId === 'bakery')) continue; // no bakery → no flour demand
    if (members.some((b) => b.typeId === 'mill')) continue; // already present
    // Mill next to the trading post (like the other workshops of the settlement) — otherwise next to the first building.
    const anchor = (members.find((b) => b.typeId === 'tradingPost') ?? members[0]).cells[0];
    const cells = findSpot(buildings, 'mill', anchor, 18);
    if (!cells) continue;
    buildings.place(typeById('mill')!, cells, 0, owner);
    changed.push(owner);
  }
  return changed;
}

/**
 * Adds missing NPC settlements (checked per name) and retrofits a missing mill
 * into existing settlements. This way newly added settlements AND the three-stage
 * bread chain reach existing saves too, without touching present villages or
 * player builds. Returns the changed names.
 */
export function generateSettlements(buildings: Buildings): string[] {
  const existing = new Set(
    [...buildings.byId.values()].map((b) => b.owner).filter((o): o is string => o !== undefined),
  );
  const founded: string[] = [];
  for (const [i, spec] of SPECS.entries()) {
    if (existing.has(spec.name)) continue; // already present (e.g. from a save)
    // Fixed slot divisor (not SPECS.length!), so a newly added village does not
    // shift the angles — and thus positions — of the existing ones.
    const angle = (i / 6) * Math.PI * 2 + 0.6;
    let near: TriCoord = {
      x: Math.round(Math.cos(angle) * 90),
      y: Math.round(Math.sin(angle) * 50),
    };
    // Ore villages first move to the nearest mountain — otherwise no mine would be buildable.
    let mineSpot: TriCoord[] | null = null;
    if (spec.atMountain) {
      mineSpot = findSpot(buildings, 'mine', near, 140);
      if (!mineSpot) continue; // no reachable mountain → no ore village
      near = mineSpot[0];
    }
    const tradingPostCells = findSpot(buildings, 'tradingPost', near, 60, true);
    if (!tradingPostCells) continue;
    const tradingPost = buildings.place(typeById('tradingPost')!, tradingPostCells, 0, spec.name)!;
    tradingPost.inv = { ...spec.startInv };
    const anchor = tradingPostCells[0];
    if (mineSpot) {
      // Mine onto the mountain — if the trading post landed exactly there, take the next free one.
      const cells = buildings.canPlace(mineSpot, 0, typeById('mine')!).ok
        ? mineSpot
        : findSpot(buildings, 'mine', anchor, 20);
      if (cells) buildings.place(typeById('mine')!, cells, 0, spec.name);
    }
    // Enough houses for the settlement's workshops (otherwise the supply jams).
    const houses: string[] = Array(spec.houses ?? 3).fill('house');
    for (const typeId of [...houses, ...spec.extras]) {
      const cells = findSpot(buildings, typeId, anchor, 18);
      if (cells) buildings.place(typeById(typeId)!, cells, 0, spec.name);
    }
    founded.push(spec.name);
  }
  // After founding: retrofit a missing mill into existing (also just-founded)
  // settlements — mainly relevant for villages from old saves.
  return [...founded, ...retrofitMills(buildings)];
}

/** Growth parameters for NPC settlements. */
export const GROWTH = {
  /** Every N economy ticks one growth check per settlement. */
  interval: 24,
  /** Bread surplus in the settlement's trading posts above which a house is added.
   *  A real surplus means: the food chain produces more than the current
   *  population consumes → there is room (and food) for more inhabitants. */
  breadSurplus: 16,
  /** Upper limit of houses per settlement (safety cap; in reality the food chain
   *  usually brakes growth earlier). */
  maxHouses: 10,
} as const;

/**
 * Lets well-supplied NPC settlements grow: if there is a real bread surplus in
 * the trading posts, a house is added. More inhabitants = more consumption →
 * the surplus drops, growth brakes itself once production and consumption are in
 * balance. If the player sells food into the settlement, the surplus rises again
 * → it keeps growing and becomes a larger market. Player builds (without owner)
 * stay untouched. Returns the names of the grown settlements.
 */
export function growSettlements(buildings: Buildings): string[] {
  const owners = new Set<string>();
  for (const b of buildings.byId.values()) {
    if (b.owner !== undefined) owners.add(b.owner);
  }
  const grown: string[] = [];
  for (const owner of owners) {
    const members = [...buildings.byId.values()].filter((b) => b.owner === owner);
    if (members.filter((b) => b.typeId === 'house').length >= GROWTH.maxHouses) continue;
    const tradingPosts = members.filter((b) => b.typeId === 'tradingPost');
    if (tradingPosts.length === 0) continue;
    const bread = tradingPosts.reduce((sum, k) => sum + stockOf(k, 'bread'), 0);
    if (bread < GROWTH.breadSurplus) continue;
    // Place the new house next to the trading post (like the settlement's other builds).
    const cells = findSpot(buildings, 'house', tradingPosts[0].cells[0], 18);
    if (!cells) continue;
    buildings.place(typeById('house')!, cells, 0, owner);
    grown.push(owner);
  }
  return grown;
}

/** All settlement names with trading post (for map labels and UI). */
export function settlementTradingPosts(buildings: Buildings): Array<{ name: string; tradingPostId: number }> {
  const result: Array<{ name: string; tradingPostId: number }> = [];
  for (const b of buildings.byId.values()) {
    if (b.owner !== undefined && b.typeId === 'tradingPost') {
      result.push({ name: b.owner, tradingPostId: b.id });
    }
  }
  return result.sort((a, b) => a.tradingPostId - b.tradingPostId);
}
