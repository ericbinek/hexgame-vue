/**
 * Carts: built transport units that shuttle between two trading posts.
 * Each cart has an outbound good and optionally a return good — it drops the
 * outbound freight at the destination, picks up (if configured) return freight
 * and unloads it at home. The logistics are controlled from the panel of the
 * home trading post; multiple carts per route are allowed.
 *
 * Trade: at foreign (NPC) trading posts loading costs money (purchase, limited
 * by the account balance) and unloading earns money (sale).
 */

import type { Building, Buildings } from './buildings';
import { buildingHex, GOODS, tradingPostCapacity, tradingPostMin, tradingPostVolumeUsed, stockOf, volumeOf } from './economy';
import { hexDistance } from './hex';

export const ROUTE = {
  cartCapacity: 8,
  hexPerTick: 3,
} as const;

/** Build price of a cart, in wood from the own trading post. */
export const CART_COST_WOOD = 5;

/** Fixed per-unit prices when trading with NPC trading posts (v1, later market-dependent). */
export const PRICES: Record<string, number> = {
  wood: 6,
  grain: 5,
  flour: 7,
  beer: 12,
  ore: 8,
  tools: 20,
  bread: 8,
};

/** Player's treasury — debited/credited when trading at foreign trading posts. */
export interface Treasury {
  money: number;
}

export type CartPhase = 'loadOut' | 'outbound' | 'unloadOut' | 'loadReturn' | 'returnTrip' | 'unloadReturn';

export interface Cart {
  id: number;
  /** Home trading post — the cart is controlled here. */
  fromId: number;
  toId: number;
  outGood: string;
  returnGood?: string;
  phase: CartPhase;
  ticksLeft: number;
  load: number;
  loadGood?: string;
}

export type RouteResult = { ok: true; route: Cart } | { ok: false; reason: string };

export class Routes {
  readonly byId = new Map<number, Cart>();
  private nextId = 1;

  constructor(private buildings: Buildings) {}

  create(fromId: number, toId: number, outGood: string, returnGood?: string): RouteResult {
    if (fromId === toId) return { ok: false, reason: 'Start und Ziel sind dasselbe Kontor' };
    const from = this.buildings.byId.get(fromId);
    const to = this.buildings.byId.get(toId);
    if (!from || from.typeId !== 'tradingPost' || !to || to.typeId !== 'tradingPost') {
      return { ok: false, reason: 'Wagen pendeln zwischen zwei Kontoren' };
    }
    if (from.owner !== undefined && to.owner !== undefined) {
      return { ok: false, reason: 'mindestens ein eigenes Kontor nötig' };
    }
    const cart: Cart = {
      id: this.nextId++,
      fromId,
      toId,
      outGood,
      returnGood,
      phase: 'loadOut',
      ticksLeft: 0,
      load: 0,
    };
    this.byId.set(cart.id, cart);
    return { ok: true, route: cart };
  }

  remove(id: number): boolean {
    return this.byId.delete(id);
  }

  routesFor(buildingId: number): Cart[] {
    return [...this.byId.values()].filter((r) => r.fromId === buildingId || r.toId === buildingId);
  }

  /** Travel duration in ticks for a route (at least 1). */
  travelTicksOf(route: Cart): number {
    const from = this.buildings.byId.get(route.fromId);
    const to = this.buildings.byId.get(route.toId);
    if (!from || !to) return 1;
    return Math.max(1, Math.ceil(hexDistance(buildingHex(from), buildingHex(to)) / ROUTE.hexPerTick));
  }

  private loadAt(w: Cart, tradingPost: Building, good: string, treasury?: Treasury): void {
    // Only load the surplus above the min reserve — the own demand stays.
    const available = Math.max(0, stockOf(tradingPost, good) - tradingPostMin(tradingPost, good));
    let take = Math.min(ROUTE.cartCapacity - w.load, available);
    const price = PRICES[good] ?? 0;
    if (treasury && tradingPost.owner !== undefined && price > 0) {
      take = Math.min(take, Math.floor(treasury.money / price)); // purchase
    }
    if (take <= 0) return;
    tradingPost.inv![good] = stockOf(tradingPost, good) - take;
    w.load += take;
    w.loadGood = good;
    if (treasury && tradingPost.owner !== undefined) treasury.money -= take * price;
  }

  /** Returns the unloaded amount (limited by the free storage volume). */
  private unloadAt(w: Cart, tradingPost: Building, treasury?: Treasury): number {
    const good = w.loadGood ?? w.outGood;
    const freeVol = tradingPostCapacity(this.buildings, tradingPost) - tradingPostVolumeUsed(tradingPost);
    const move = Math.min(w.load, Math.floor(freeVol / volumeOf(good)));
    if (move <= 0) return 0;
    tradingPost.inv = tradingPost.inv ?? {};
    tradingPost.inv[good] = stockOf(tradingPost, good) + move;
    w.load -= move;
    if (treasury && tradingPost.owner !== undefined) {
      treasury.money += move * (PRICES[good] ?? 0); // sale
    }
    return move;
  }

  /** Moves all carts by one tick. Returns the total amount delivered. */
  tick(treasury?: Treasury): number {
    let delivered = 0;
    for (const w of [...this.byId.values()]) {
      const from = this.buildings.byId.get(w.fromId);
      const to = this.buildings.byId.get(w.toId);
      if (!from || from.typeId !== 'tradingPost' || !to || to.typeId !== 'tradingPost') {
        this.byId.delete(w.id); // endpoint demolished → cart dissolves
        continue;
      }
      const travel = this.travelTicksOf(w);
      switch (w.phase) {
        case 'loadOut': {
          this.loadAt(w, from, w.outGood, treasury);
          if (w.load > 0) {
            w.phase = 'outbound';
            w.ticksLeft = travel;
          }
          break;
        }
        case 'outbound': {
          if (--w.ticksLeft <= 0) w.phase = 'unloadOut';
          break;
        }
        case 'unloadOut': {
          delivered += this.unloadAt(w, to, treasury);
          if (w.load === 0) {
            if (w.returnGood) {
              w.phase = 'loadReturn';
            } else {
              w.phase = 'returnTrip';
              w.ticksLeft = travel;
            }
          }
          break;
        }
        case 'loadReturn': {
          // Load once, then set off — even empty, otherwise the cart blocks at
          // the destination when the return good is currently missing there.
          this.loadAt(w, to, w.returnGood!, treasury);
          w.phase = 'returnTrip';
          w.ticksLeft = travel;
          break;
        }
        case 'returnTrip': {
          if (--w.ticksLeft <= 0) w.phase = w.load > 0 ? 'unloadReturn' : 'loadOut';
          break;
        }
        case 'unloadReturn': {
          delivered += this.unloadAt(w, from, treasury);
          if (w.load === 0) w.phase = 'loadOut';
          break;
        }
      }
    }
    return delivered;
  }

  phaseText(w: Cart): string {
    const name = (g?: string) => (g ? GOODS[g] ?? g : '?');
    switch (w.phase) {
      case 'loadOut':
        return w.load > 0 ? `lädt ${name(w.outGood)}` : `wartet auf ${name(w.outGood)}`;
      case 'outbound':
        return `unterwegs (${w.ticksLeft} Ticks, ${w.load} ${name(w.loadGood)})`;
      case 'unloadOut':
        return 'entlädt beim Ziel';
      case 'loadReturn':
        return `lädt Rückfracht (${name(w.returnGood)})`;
      case 'returnTrip':
        return w.load > 0
          ? `Rückweg (${w.ticksLeft} Ticks, ${w.load} ${name(w.loadGood)})`
          : `Rückweg leer (${w.ticksLeft} Ticks)`;
      case 'unloadReturn':
        return 'entlädt daheim';
    }
  }

  serialize(): string {
    return JSON.stringify({ v: 2, nextId: this.nextId, routes: [...this.byId.values()] });
  }

  restore(json: string): number {
    const data = JSON.parse(json) as {
      v: number;
      nextId: number;
      routes: Array<Cart & { good?: string; phase: string }>;
    };
    if ((data.v !== 1 && data.v !== 2) || !Array.isArray(data.routes)) return 0;
    const legacyPhases: Record<string, CartPhase> = { laden: 'loadOut', entladen: 'unloadOut' };
    for (const r of data.routes) {
      const cart: Cart = {
        ...r,
        outGood: r.outGood ?? r.good ?? 'beer',
        phase: (legacyPhases[r.phase] ?? r.phase) as CartPhase,
      };
      this.byId.set(cart.id, cart);
    }
    this.nextId = Math.max(data.nextId, ...data.routes.map((r) => r.id + 1), 1);
    return data.routes.length;
  }
}
