/**
 * Game-logic commands: encapsulate rules + mutations and return a result
 * (`{ ok: true, … } | { ok: false, reason }`). They do **not** render and set
 * no notices — the caller (operations.ts) decides about messaging and refresh.
 *
 * Ported from original/src/game/actions.ts; works with the vue store instead of
 * GameState.
 */
import { footprintAt, type Building, type BuildingType } from '../core/buildings'
import { FOUNDING_STOCK, payBuildCost, stockOf } from '../core/economy'
import { CART_COST_WOOD } from '../core/routes'
import type { TriCoord } from '../core/tri'
import type { Store } from './store'

export type CommandResult = { ok: true } | { ok: false; reason: string }

/**
 * Preview footprint of the current build mode at the cursor: cells plus whether
 * (and why not) building is allowed there. Pure query — used by the overlay.
 */
export function ghostFootprint(
  store: Store,
): { cells: TriCoord[]; ok: boolean; reason?: string } | null {
  const { mode, hover, zLevel, buildings } = store
  if (mode.kind !== 'build' || !hover) return null
  const cells = footprintAt(hover)
  const res = buildings.canPlace(cells, zLevel, mode.type)
  if (!res.ok) return { cells, ok: false, reason: res.reason }
  const pay = payBuildCost(buildings, mode.type.id, hover, { dryRun: true })
  if (!pay.ok) return { cells, ok: false, reason: pay.reason }
  return { cells, ok: true }
}

/** The first player trading post receives the founding stock. Returns whether it was granted. */
export function grantFoundingStock(store: Store, placed: Building): boolean {
  if (placed.typeId !== 'tradingPost') return false
  const playerTradingPosts = [...store.buildings.byId.values()].filter(
    (b) => b.typeId === 'tradingPost' && b.owner === undefined,
  )
  if (playerTradingPosts.length !== 1) return false
  placed.inv = { wood: FOUNDING_STOCK }
  return true
}

/**
 * Places a player building: check rules, deduct build cost, set it, possibly
 * grant the founding stock. `granted` signals the founding message.
 */
export function tryBuildAt(
  store: Store,
  type: BuildingType,
  tri: TriCoord,
  z: number,
): { ok: true; building: Building; granted: boolean } | { ok: false; reason: string } {
  const { buildings } = store
  const cells = footprintAt(tri)
  const res = buildings.canPlace(cells, z, type)
  if (!res.ok) return { ok: false, reason: res.reason }
  const pay = payBuildCost(buildings, type.id, tri)
  if (!pay.ok) return { ok: false, reason: pay.reason }
  const building = buildings.place(type, cells, z)!
  const granted = grantFoundingStock(store, building)
  return { ok: true, building, granted }
}

/** Demolishes the building on the active level. NPC buildings are protected. */
export function tryDemolishAt(store: Store, tri: TriCoord): CommandResult {
  const { buildings, zLevel } = store
  const target = buildings.at(tri.x, tri.y, zLevel)
  if (target?.owner !== undefined) {
    return { ok: false, reason: `Das gehört ${target.owner} — Abriss nicht möglich` }
  }
  const res = buildings.removeAt(tri.x, tri.y, zLevel)
  if (!res.ok) return { ok: false, reason: `Abriss: ${res.reason}` }
  return { ok: true }
}

/**
 * A cart costs wood from the own (player) endpoint of the route. dryRun = check only.
 */
export function payCartCost(
  store: Store,
  fromId: number,
  toId: number,
  dryRun = false,
): CommandResult {
  const { buildings } = store
  const from = buildings.byId.get(fromId)
  const to = buildings.byId.get(toId)
  const payer = from?.owner === undefined ? from : to?.owner === undefined ? to : undefined
  if (!payer) return { ok: false, reason: 'mindestens ein eigenes Kontor nötig' }
  const have = stockOf(payer, 'wood')
  if (have < CART_COST_WOOD) {
    return { ok: false, reason: `Wagen kostet ${CART_COST_WOOD} Holz im eigenen Kontor (${have} da)` }
  }
  if (!dryRun) payer.inv!.wood = have - CART_COST_WOOD
  return { ok: true }
}

/** Creates a cart between two trading posts (wood cost at the own endpoint). */
export function tryCreateCart(store: Store, fromId: number, toId: number): CommandResult {
  const cost = payCartCost(store, fromId, toId, true)
  if (!cost.ok) return cost
  const res = store.routes.create(fromId, toId, 'beer')
  if (!res.ok) return { ok: false, reason: res.reason }
  payCartCost(store, fromId, toId)
  return { ok: true }
}
