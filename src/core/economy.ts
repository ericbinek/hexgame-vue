/**
 * Economy tick v2 — recipes and production chains:
 *
 *   House → provides workers
 *   Producers (sawmill, farm, brewery) → recipe: optional input goods,
 *     one output good per tick into its own buffer
 *   Trading post → hub: collects output goods within the hex radius and
 *     delivers input goods to producers in range
 *
 * The chain farm → grain → trading post → brewery → beer → trading post thus
 * runs across the map: distance decides whether supplies arrive. Full buffers,
 * missing workers, or missing input goods stop production.
 */

import type { Building, Buildings } from './buildings';
import { hexDistance, triToHex, type HexCoord } from './hex';
import type { TriCoord } from './tri';

export const TICK_MS = 2000;

export const GOODS: Record<string, string> = {
  wood: 'Holz',
  grain: 'Korn',
  flour: 'Mehl',
  beer: 'Bier',
  ore: 'Erz',
  tools: 'Werkzeug',
  bread: 'Brot',
};

/**
 * Space required per good unit in m³ — raw materials are bulky, finished goods
 * compact. The trading post warehouse is measured in volume instead of unit
 * count so that more realistic quantities result (one cart of ore ≫ one bread).
 */
export const VOLUMES: Record<string, number> = {
  ore: 4,
  wood: 3,
  grain: 2,
  // Flour is milled/bagged → more compact than bulk grain, otherwise the
  // intermediate good clogs the trading post and crowds out the end goods.
  flour: 1,
  beer: 1,
  bread: 1,
  tools: 1,
};

export function volumeOf(good: string): number {
  return VOLUMES[good] ?? 1;
}

/** Goods of the food chain — their producers take priority when workers are scarce.
 *  Flour belongs to it (grain → flour → bread), otherwise industry binds the workers
 *  and the mill stays empty, which starves the bakery. */
const FOOD_CHAIN = new Set(['grain', 'flour', 'bread', 'beer']);

export interface Recipe {
  workers: number;
  /** Input goods per produced unit. */
  inputs?: Record<string, number>;
  output: string;
  /** Maximum output buffer; full = production stops. */
  buffer: number;
}

export const RECIPES: Record<string, Recipe> = {
  sawmill: { workers: 2, output: 'wood', buffer: 8 },
  farm: { workers: 2, output: 'grain', buffer: 8 },
  brewery: { workers: 2, inputs: { grain: 2 }, output: 'beer', buffer: 8 },
  // Food chain in three stages: farm (grain) → mill (2 grain → flour) → bakery
  // (1 flour → bread). The mill doubles the grain demand, the longer chain
  // binds more workers — in return, surplus grain becomes durable flour.
  mill: { workers: 2, inputs: { grain: 2 }, output: 'flour', buffer: 8 },
  bakery: { workers: 2, inputs: { flour: 1 }, output: 'bread', buffer: 8 },
  mine: { workers: 2, output: 'ore', buffer: 8 },
  smithy: { workers: 2, inputs: { ore: 1, wood: 1 }, output: 'tools', buffer: 8 },
};

/** Build costs in wood — must be stored in a trading post within range of the site. */
export const BUILD_COSTS: Record<string, number> = {
  shed: 1,
  house: 3,
  sawmill: 4,
  farm: 4,
  brewery: 5,
  mill: 5,
  bakery: 5,
  mine: 6,
  smithy: 6,
  tradingPost: 0,
};

/** Wood gift in the first player trading post so that founding is possible.
 *  Enough for a self-sufficient starter town including the three-stage food chain
 *  (sawmill + farm + mill + bakery + houses) and one shed.
 *  36 wood = 108 m³ — still fits into the base warehouse volume (120 m³). */
export const FOUNDING_STOCK = 36;

export const ECON = {
  /** Base warehouse volume of a trading post in m³ (expandable via sheds).
   *  Must hold the typical start/raw-material quantities — wood is bulky at
   *  3 m³/unit (founding stock 30 wood = 90 m³), otherwise it clogs the
   *  warehouse and blocks collecting the food. */
  tradingPostBaseVolume: 120,
  /** Additional warehouse volume per shed in the trading post column. */
  shedVolume: 30,
  tradingPostRadius: 6,
  /** How many units a trading post collects per tick. Higher than the
   *  production of a nearby operation (productionNear) so it does not clog. */
  collectPerTick: 8,
  /** Maximum input buffer per good at the producer (unit-based). Must hold the
   *  daily demand of a nearby operation (productionNear × recipe amount). */
  inputBuffer: 16,
  /** Catchment area of an operation in hex fields: only houses within it provide
   *  workers. = productionNear − 1, so each stage means exactly 1 unit/tick. */
  workerRadius: 3,
  /** Units/tick of an operation at commute distance 0 (house on/next to the operation).
   *  1 unit less per hex of average commute distance, at least 1 → 4 stages:
   *  distance 0→4, 1→3, 2→2, 3→1 units/tick. */
  productionNear: 4,
  /** Default warehouse limit per good as volume (m³), so that no single (bulky)
   *  good fills the entire trading post and crowds out the others. Converted to units. */
  defaultTradingPostMaxVolume: 40,
  /** Houses consume bread and beer every N ticks (staggered per house). */
  consumptionInterval: 8,
  /** Target stock of bread or beer per house — dampens production fluctuations. */
  houseStock: 6,
  /** Operations become due for maintenance every N ticks (1 wood from the trading post). */
  maintenanceInterval: 16,
} as const;

/**
 * Workers per house: 1 (emergency) + 1 per stocked food (bread, beer),
 * i.e. 1..3. Fresh houses (no inventory yet) count as bread-supplied,
 * so the town can ramp up until the first delivery arrives.
 */
export function workersOf(b: Building): number {
  if (b.typeId !== 'house') return 0;
  if (!b.inv) return 2;
  return 1 + (stockOf(b, 'bread') > 0 ? 1 : 0) + (stockOf(b, 'beer') > 0 ? 1 : 0);
}

export interface EconomyReport {
  tick: number;
  workersTotal: number;
  workersUsed: number;
  produced: number;
  collected: number;
  consumed: number;
  stored: Record<string, number>;
}

function inv(b: Building): Record<string, number> {
  return (b.inv ??= {});
}

export function stockOf(b: Building, good: string): number {
  return b.inv?.[good] ?? 0;
}

export function buildingHex(b: Building): HexCoord {
  return triToHex(b.cells[0].x, b.cells[0].y);
}

/** Used warehouse volume of a trading post in m³ (sum of units × good volume). */
export function tradingPostVolumeUsed(k: Building): number {
  return Object.entries(k.inv ?? {}).reduce((sum, [g, n]) => sum + n * volumeOf(g), 0);
}

/**
 * Warehouse capacity of a trading post in m³: base plus per shed in the same
 * (x,y) column (vertically above/below the trading post, any z level).
 */
export function tradingPostCapacity(buildings: Buildings, k: Building): number {
  const { x, y } = k.cells[0];
  let sheds = 0;
  for (const b of buildings.byId.values()) {
    if (b.typeId === 'shed' && b.cells[0].x === x && b.cells[0].y === y) sheds++;
  }
  return ECON.tradingPostBaseVolume + sheds * ECON.shedVolume;
}

/** Upper limit of an operation's output good (player setting or recipe buffer). */
export function maxOutputOf(b: Building): number {
  return b.maxOutput ?? RECIPES[b.typeId]?.buffer ?? 8;
}

/** Workers required by the operation per its recipe (non-operations: 0). */
export function workersNeeded(b: Building): number {
  return RECIPES[b.typeId]?.workers ?? 0;
}

/** Collection/storage limit of a good in the trading post (player setting or volume-based default). */
export function tradingPostMax(k: Building, good: string): number {
  return k.limits?.[good]?.max ?? Math.floor(ECON.defaultTradingPostMaxVolume / volumeOf(good));
}

/** Export reserve of a good in the trading post: only the surplus above it is loaded/sold. */
export function tradingPostMin(k: Building, good: string): number {
  return k.limits?.[good]?.min ?? 0;
}

/**
 * Check or charge build costs: the wood must be stored in the owner's trading
 * posts within range of the site. dryRun = check only.
 */
export function payBuildCost(
  buildings: Buildings,
  typeId: string,
  site: TriCoord,
  opts: { dryRun?: boolean; owner?: string } = {},
): { ok: true; cost: number } | { ok: false; reason: string; cost: number } {
  const cost = BUILD_COSTS[typeId] ?? 0;
  if (cost === 0) return { ok: true, cost };
  const siteHex = triToHex(site.x, site.y);
  const tradingPosts = [...buildings.byId.values()]
    .filter((b) => b.typeId === 'tradingPost' && b.owner === opts.owner)
    .filter((b) => hexDistance(siteHex, buildingHex(b)) <= ECON.tradingPostRadius)
    .sort((a, b) => a.id - b.id);
  const available = tradingPosts.reduce((sum, k) => sum + stockOf(k, 'wood'), 0);
  if (available < cost) {
    return { ok: false, reason: `braucht ${cost} Holz in einem Kontor im Umkreis (${available} da)`, cost };
  }
  if (!opts.dryRun) {
    let rest = cost;
    for (const k of tradingPosts) {
      const take = Math.min(rest, stockOf(k, 'wood'));
      if (take > 0) {
        inv(k).wood = stockOf(k, 'wood') - take;
        rest -= take;
      }
      if (rest === 0) break;
    }
  }
  return { ok: true, cost };
}

export class Economy {
  tickCount = 0;
  private active = new Set<number>();
  /** Average commute distance (hex) of the workers assigned in the last tick, per operation. */
  private commute = new Map<number, number>();

  constructor(private buildings: Buildings) {}

  /** Did this producer have workers in the last tick? */
  isActive(b: Building): boolean {
    return this.active.has(b.id);
  }

  /**
   * Workers actually assigned to an operation in the last tick. The assignment
   * is binary: an active operation has all the workers it needs, an inactive one
   * none. Non-operations (house/trading post) neither provide nor need any → 0.
   */
  assignedWorkers(b: Building): number {
    return this.isActive(b) ? workersNeeded(b) : 0;
  }

  /**
   * Rounded average commute distance (hex) of the workers of an active operation;
   * undefined if the operation had no workers. 0 = house on/next to the operation.
   */
  commuteOf(b: Building): number | undefined {
    const d = this.commute.get(b.id);
    return d === undefined ? undefined : Math.round(d);
  }

  /**
   * Units/tick of an active operation: productionNear minus rounded commute distance,
   * at least 1. Inactive operations: 0. So the travel time reduces the quantity in
   * integer steps (4 stages, see ECON.productionNear), without fractions.
   */
  productionAmountOf(b: Building): number {
    if (!this.isActive(b)) return 0;
    return Math.max(1, ECON.productionNear - (this.commuteOf(b) ?? 0));
  }

  private sorted(): Building[] {
    return [...this.buildings.byId.values()].sort((a, b) => a.id - b.id);
  }

  /** Total stock in the trading posts of an owner (default: player). */
  totalStored(good: string, owner?: string): number {
    return this.sorted()
      .filter((b) => b.typeId === 'tradingPost' && b.owner === owner)
      .reduce((sum, k) => sum + stockOf(k, good), 0);
  }

  /** Workers of an owner (default: player). */
  workersTotal(owner?: string): number {
    return this.sorted()
      .filter((b) => b.owner === owner)
      .reduce((sum, b) => sum + workersOf(b), 0);
  }

  /**
   * Draws up to `amount` of a good for internal demand: first from trading posts
   * in range, then (if the trading post does not have it) directly from producers
   * that make it. This smooths the oscillations without everything having to run
   * through the trading post first. The export reserve (tradingPostMin) does not apply here.
   */
  private draw(fromHex: HexCoord, good: string, amount: number, tradingPosts: Building[], producers: Building[]): number {
    let got = 0;
    const sources = [...tradingPosts, ...producers.filter((p) => RECIPES[p.typeId].output === good)];
    for (const s of sources) {
      if (got >= amount) break;
      if (hexDistance(fromHex, buildingHex(s)) > ECON.tradingPostRadius) continue;
      const take = Math.min(amount - got, stockOf(s, good));
      if (take <= 0) continue;
      inv(s)[good] = stockOf(s, good) - take;
      got += take;
    }
    return got;
  }


  /**
   * One tick. Each owner (player, every NPC settlement) operates as its own
   * economic loop: own workers, own trading posts, own consumption. Exchange
   * between the loops runs exclusively via trade routes. The report contains
   * the player numbers.
   */
  tick(): EconomyReport {
    this.tickCount++;
    this.active.clear();
    this.commute.clear();
    const groups = new Map<string | undefined, Building[]>();
    for (const b of this.sorted()) {
      const list = groups.get(b.owner);
      if (list) list.push(b);
      else groups.set(b.owner, [b]);
    }
    let player = { workersTotal: 0, workersUsed: 0, produced: 0, collected: 0, consumed: 0 };
    for (const [owner, members] of groups) {
      const result = this.tickGroup(members);
      if (owner === undefined) player = result;
    }
    return {
      tick: this.tickCount,
      ...player,
      stored: Object.fromEntries(Object.keys(GOODS).map((g) => [g, this.totalStored(g)])),
    };
  }

  private tickGroup(all: Building[]): Omit<EconomyReport, 'tick' | 'stored'> {
    const producers = all.filter((b) => RECIPES[b.typeId]);
    const tradingPosts = all.filter((b) => b.typeId === 'tradingPost');
    const houses = all.filter((b) => b.typeId === 'house');

    // 0) Consumption: houses keep a stock of bread and beer. They consume food
    //    every consumptionInterval ticks depending on the population and refill
    //    the stock every tick (first from trading posts, then directly at
    //    producers). The stock dampens the production fluctuations.
    let consumed = 0;
    for (const h of houses) {
      const hh = buildingHex(h);
      if ((this.tickCount + h.id) % ECON.consumptionInterval === 0) {
        const residents = workersOf(h); // determines the consumed amount
        // always commit inv here (even empty), so the fresh bonus ends
        // and a permanently unsupplied house falls back to the emergency.
        for (const good of ['bread', 'beer'] as const) {
          const eat = Math.min(stockOf(h, good), residents);
          inv(h)[good] = stockOf(h, good) - eat;
          consumed += eat;
        }
      }
      for (const good of ['bread', 'beer'] as const) {
        const want = ECON.houseStock - stockOf(h, good);
        if (want <= 0) continue;
        const got = this.draw(hh, good, want, tradingPosts, producers);
        if (got > 0) inv(h)[good] = stockOf(h, good) + got;
      }
    }

    // 0.5) Maintenance: due operations draw 1 wood from their own trading post;
    //      without wood they stay due for maintenance and stand still.
    for (const p of producers) {
      if (!p.needsMaintenance && (this.tickCount + p.id) % ECON.maintenanceInterval === 0) {
        p.needsMaintenance = true;
      }
      if (!p.needsMaintenance) continue;
      const ph = buildingHex(p);
      for (const k of tradingPosts) {
        if (hexDistance(ph, buildingHex(k)) > ECON.tradingPostRadius) continue;
        if (stockOf(k, 'wood') < 1) continue;
        inv(k).wood = stockOf(k, 'wood') - 1;
        p.needsMaintenance = false;
        break;
      }
    }

    // 1) Assign workers locally. Each operation draws its workers from houses
    //    within the workerRadius, in ascending order of distance — the average
    //    commute distance later determines the unit count (travel time as an economic factor).
    //    Order of operations: first the food chain (grain/flour/bread/beer), then
    //    industry (otherwise the bakery starves); within that by proximity to the
    //    nearest house (closer first → on scarcity the well-located operation wins).
    //    A satisfied operation (max output) and one due for maintenance claim nothing.
    //    Column binding: a house in the same (x,y) column as an operation
    //    (typically built directly above it) is firmly assigned to it. Its workers
    //    are RESERVED for it — no other operation (not even the preferred food
    //    chain) may draw them, and its own operation takes them first.
    //    So "build house onto the operation" reliably staffs it, instead of being
    //    at the mercy of the global priority.
    const workersTotal = all.reduce((sum, b) => sum + workersOf(b), 0);
    const rest = new Map<number, number>(); // house id → still free workers
    for (const h of houses) rest.set(h.id, workersOf(h));
    const bound = new Map<number, number>(); // house id → operation id (same column)
    for (const h of houses) {
      const q = producers.find((p) => p.cells[0].x === h.cells[0].x && p.cells[0].y === h.cells[0].y);
      if (q) bound.set(h.id, q.id);
    }
    const nearestHouse = new Map<number, number>(); // operation id → distance to nearest house
    for (const p of producers) {
      const ph = buildingHex(p);
      let min = Infinity;
      for (const h of houses) min = Math.min(min, hexDistance(ph, buildingHex(h)));
      nearestHouse.set(p.id, min);
    }
    const byPriority = [...producers].sort((a, b) => {
      const fa = FOOD_CHAIN.has(RECIPES[a.typeId].output) ? 0 : 1;
      const fb = FOOD_CHAIN.has(RECIPES[b.typeId].output) ? 0 : 1;
      return fa - fb || nearestHouse.get(a.id)! - nearestHouse.get(b.id)! || a.id - b.id;
    });
    let workersUsed = 0;
    for (const p of byPriority) {
      if (p.needsMaintenance) continue;
      if (stockOf(p, RECIPES[p.typeId].output) >= maxOutputOf(p)) continue;
      const need = RECIPES[p.typeId].workers;
      const ph = buildingHex(p);
      const candidates = houses
        .map((h) => ({ h, d: hexDistance(ph, buildingHex(h)) }))
        .filter((x) => {
          if (x.d > ECON.workerRadius || (rest.get(x.h.id) ?? 0) <= 0) return false;
          const on = bound.get(x.h.id);
          return on === undefined || on === p.id; // houses bound to a foreign operation: off-limits
        })
        // own column house first, then by distance, then by id.
        .sort((x, y) => {
          const bx = bound.get(x.h.id) === p.id ? 0 : 1;
          const by = bound.get(y.h.id) === p.id ? 0 : 1;
          return bx - by || x.d - y.d || x.h.id - y.h.id;
        });
      const dists: number[] = [];
      const fromHouse: number[] = [];
      for (const { h, d } of candidates) {
        let avail = rest.get(h.id)!;
        while (avail > 0 && dists.length < need) {
          dists.push(d);
          fromHouse.push(h.id);
          avail--;
        }
        if (dists.length >= need) break;
      }
      if (dists.length < need) continue; // not enough workers in range
      for (const hid of fromHouse) rest.set(hid, rest.get(hid)! - 1);
      this.active.add(p.id);
      this.commute.set(p.id, dists.reduce((s, d) => s + d, 0) / dists.length);
      workersUsed += need;
    }

    // 2) Acquire input goods: enough for this tick's planned unit count
    //    (productionAmountOf × recipe amount), first from trading posts, otherwise
    //    directly from producers. Otherwise a nearby (fast) operation cannot run at full.
    for (const p of producers) {
      const recipe = RECIPES[p.typeId];
      if (!recipe.inputs || !this.active.has(p.id)) continue;
      const ph = buildingHex(p);
      const amount = this.productionAmountOf(p);
      for (const [good, qty] of Object.entries(recipe.inputs)) {
        const want = Math.min(ECON.inputBuffer - stockOf(p, good), amount * qty);
        if (want > 0) inv(p)[good] = stockOf(p, good) + this.draw(ph, good, want, tradingPosts, producers);
      }
    }

    // 3) Production: up to productionAmountOf units, limited by the free output
    //    buffer and the available input goods. Input is consumed per unit.
    let produced = 0;
    for (const p of producers) {
      if (!this.active.has(p.id)) continue;
      const recipe = RECIPES[p.typeId];
      let amount = Math.min(this.productionAmountOf(p), maxOutputOf(p) - stockOf(p, recipe.output));
      if (recipe.inputs) {
        for (const [good, qty] of Object.entries(recipe.inputs)) {
          amount = Math.min(amount, Math.floor(stockOf(p, good) / qty));
        }
      }
      if (amount <= 0) continue;
      if (recipe.inputs) {
        for (const [good, qty] of Object.entries(recipe.inputs)) {
          inv(p)[good] = stockOf(p, good) - qty * amount;
        }
      }
      inv(p)[recipe.output] = stockOf(p, recipe.output) + amount;
      produced += amount;
    }

    // 4) Trading posts collect output goods in range (limited by the free
    //    warehouse volume in m³).
    let collected = 0;
    for (const k of tradingPosts) {
      let budget = ECON.collectPerTick;
      const cap = tradingPostCapacity(this.buildings, k);
      const kh = buildingHex(k);
      for (const p of producers) {
        if (budget <= 0) break;
        if (hexDistance(kh, buildingHex(p)) > ECON.tradingPostRadius) continue;
        const good = RECIPES[p.typeId].output;
        const fitsVol = Math.floor((cap - tradingPostVolumeUsed(k)) / volumeOf(good));
        const fitsMax = tradingPostMax(k, good) - stockOf(k, good); // collection limit per good
        const move = Math.min(stockOf(p, good), budget, fitsVol, fitsMax);
        if (move <= 0) continue;
        inv(p)[good] = stockOf(p, good) - move;
        inv(k)[good] = stockOf(k, good) + move;
        budget -= move;
        collected += move;
      }
    }

    return {
      workersTotal,
      workersUsed,
      produced,
      collected,
      consumed,
    };
  }

  statusText(b: Building): string {
    if (b.typeId === 'house') {
      const v = ECON.houseStock;
      return `${workersOf(b)} Arbeiter · Vorrat Brot ${stockOf(b, 'bread')}/${v} · Bier ${stockOf(b, 'beer')}/${v}`;
    }
    if (b.typeId === 'tradingPost') {
      const used = Math.round(tradingPostVolumeUsed(b));
      const cap = tradingPostCapacity(this.buildings, b);
      return `sammelt und liefert im Umkreis von ${ECON.tradingPostRadius} Hexfeldern · Lager ${used}/${cap} m³`;
    }
    const recipe = RECIPES[b.typeId];
    if (!recipe) return 'noch ohne Funktion';
    if (b.needsMaintenance) return 'Wartung fällig — braucht 1 Holz im Kontor';
    const out = stockOf(b, recipe.output);
    const max = maxOutputOf(b);
    if (out >= max) return `Max erreicht (${out}/${max}) — wartet aufs Kontor`;
    if (this.tickCount > 0 && !this.isActive(b)) {
      return `steht still — keine Arbeiter in Reichweite (${ECON.workerRadius} Hexfelder)`;
    }
    if (recipe.inputs) {
      for (const [good, qty] of Object.entries(recipe.inputs)) {
        const have = stockOf(b, good);
        if (have < qty) return `wartet auf ${GOODS[good] ?? good} (${have}/${qty})`;
      }
    }
    return `produziert ${GOODS[recipe.output] ?? recipe.output} (${out}/${max})`;
  }
}
