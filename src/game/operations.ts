/**
 * High-level game operations: translate inputs (click, button) into store
 * mutations and keep the reactive display in sync. Mirrors the game ops from
 * original/src/game/game.ts (clickCell/demolishAt/setMode/setSpeed), just
 * without rendering — drawing happens in the loop in main.ts.
 */
import { typeById } from '../core/buildings'
import {
  GOODS,
  FOUNDING_STOCK,
  RECIPES,
  maxOutputOf,
  stockOf,
  tradingPostMax,
  tradingPostMin,
  workersNeeded,
} from '../core/economy'
import { PRICES } from '../core/routes'
import { triCentroid, type TriCoord } from '../core/tri'
import { tryBuildAt, tryCreateCart, tryDemolishAt } from './actions'
import { save } from './persistence'
import { updateCounters, type CartRow, type LimitRow, type Mode, type Store } from './store'

function persist(store: Store): void {
  save(store.buildings, store.routes, store.treasury)
}

function layerName(z: number): string {
  return z === 0 ? 'EG' : z > 0 ? `OG ${z}` : `UG ${-z}`
}

export function setMode(store: Store, mode: Mode): void {
  store.mode = mode
  store.display.modeId =
    mode.kind === 'build' ? mode.type.id : mode.kind === 'route' ? 'route' : 'select'
}

export function setSpeed(store: Store, speed: number): void {
  store.speed = speed
  store.display.speed = speed
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null
export function setNotice(store: Store, text: string): void {
  store.display.notice = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    store.display.notice = ''
    noticeTimer = null
  }, 4000)
}

/**
 * Click on the map: in build mode place, otherwise select the building below.
 * Returns true when a building was created (redraw objects).
 */
export function clickMap(store: Store, tri: TriCoord): boolean {
  const mode = store.mode
  if (mode.kind === 'route') {
    const b = store.buildings.at(tri.x, tri.y, store.zLevel)
    if (!b || b.typeId !== 'tradingPost') {
      setNotice(store, 'Route: ein Kontor anklicken')
      return false
    }
    if (mode.fromId === null) {
      store.mode = { kind: 'route', fromId: b.id }
      setNotice(store, `Wagen: Heimat-Kontor #${b.id} — jetzt das Ziel-Kontor anklicken`)
      return false
    }
    const res = tryCreateCart(store, mode.fromId, b.id)
    if (res.ok) {
      setNotice(store, `Wagen gebaut: #${mode.fromId} → #${b.id} (Fracht im Kontor-Panel wählbar)`)
      store.mode = { kind: 'route', fromId: null }
      persist(store)
      if (store.selectedBuildingId !== null) updateSelection(store)
    } else {
      setNotice(store, `Wagen: ${res.reason}`)
    }
    return false
  }
  if (mode.kind === 'build') {
    const res = tryBuildAt(store, mode.type, tri, store.zLevel)
    if (!res.ok) {
      setNotice(store, `Bauen: ${res.reason}`)
      return false
    }
    if (res.granted) setNotice(store, `Gründungsvorrat: ${FOUNDING_STOCK} Holz im neuen Kontor`)
    updateCounters(store)
    persist(store)
    return true
  }
  store.selected = tri
  store.selectedBuildingId = store.buildings.at(tri.x, tri.y, store.zLevel)?.id ?? null
  updateSelection(store)
  return false
}

/** Right-click: demolish on the active level. Returns true on success. */
export function demolishOnMap(store: Store, tri: TriCoord): boolean {
  const res = tryDemolishAt(store, tri)
  if (!res.ok) {
    setNotice(store, res.reason)
    return false
  }
  if (store.selectedBuildingId !== null && !store.buildings.byId.has(store.selectedBuildingId)) {
    store.selectedBuildingId = null
    store.selected = null
    updateSelection(store)
  }
  updateCounters(store)
  persist(store)
  return true
}

/** Computes the info panel (text lines + interactive control data) for the selection. */
export function updateSelection(store: Store): void {
  const b =
    store.selectedBuildingId === null ? undefined : store.buildings.byId.get(store.selectedBuildingId)
  if (!b) {
    store.display.selection = null
    return
  }
  const type = typeById(b.typeId)
  const own = b.owner === undefined
  const isTradingPost = b.typeId === 'tradingPost'
  const recipe = RECIPES[b.typeId]

  const lines: string[] = [`Ebene ${layerName(b.z)} · ${b.cells.length} Dreieck${b.cells.length === 1 ? '' : 'e'}`]
  if (!own) lines.push(`gehört ${b.owner}`)
  lines.push(store.economy.statusText(b))
  if (recipe) {
    const commute = store.economy.commuteOf(b)
    const commuteText =
      commute === undefined ? '' : ` · Weg ${commute} Hex → ${store.economy.productionAmountOf(b)}/Tick`
    lines.push(`Arbeiter ${store.economy.assignedWorkers(b)}/${workersNeeded(b)}${commuteText}`)
  }
  // Foreign trading posts: show the fixed trade prices (read-only).
  if (!own && isTradingPost) {
    const prices = Object.entries(PRICES)
      .map(([g, p]) => `${GOODS[g] ?? g} ${p}`)
      .join(' · ')
    lines.push(`Handel je Einheit: ${prices}`)
  }
  if (b.typeId !== 'house') {
    for (const [good, label] of Object.entries(GOODS)) {
      const n = stockOf(b, good)
      if (n > 0) lines.push(`${label}: ${n}`)
    }
  }

  // Storage limits (min reserve / max collection) — only for own trading posts.
  const limits: LimitRow[] =
    own && isTradingPost
      ? Object.entries(GOODS).map(([good, label]) => ({
          good,
          label,
          min: tradingPostMin(b, good),
          max: tradingPostMax(b, good),
        }))
      : []

  // Carts at this trading post; freight is controllable only at the cart's home.
  const carts: CartRow[] = isTradingPost
    ? store.routes.routesFor(b.id).map((c) => ({
        id: c.id,
        label: c.fromId === b.id ? `Wagen → #${c.toId}` : `Wagen ← #${c.fromId}`,
        phase: store.routes.phaseText(c),
        controllable: c.fromId === b.id,
        outGood: c.outGood,
        returnGood: c.returnGood ?? '',
      }))
    : []

  store.display.selection = {
    id: b.id,
    title: `${type?.name ?? b.typeId} #${b.id}`,
    lines,
    demolishable: own,
    recipeOutput: own && recipe ? recipe.output : null,
    recipeOutputLabel: recipe ? GOODS[recipe.output] ?? recipe.output : '',
    maxOutput: maxOutputOf(b),
    limits,
    carts,
  }
}

/**
 * Demolishes the currently selected building — for the info panel's demolish
 * button. Returns true on success (redraw map).
 */
export function demolishSelection(store: Store): boolean {
  if (!store.selected) return false
  return demolishOnMap(store, store.selected)
}

/** Switches into route mode (place carts by clicking two trading posts). */
export function startRouteMode(store: Store): void {
  setMode(store, { kind: 'route', fromId: null })
}

/** Centers the camera on a building (used by the town list). */
export function focusBuilding(store: Store, id: number): void {
  const b = store.buildings.byId.get(id)
  if (!b) return
  const c = triCentroid(b.cells[0].x, b.cells[0].y)
  store.camera.cx = c.x
  store.camera.cy = c.y
}

// --- Panel controls (own buildings only): mutate, persist, refresh the panel ---

function afterPanelMutation(store: Store): void {
  persist(store)
  updateSelection(store)
}

/** Sets a producer's max output (reached → production stops, workers freed). */
export function setMaxOutput(store: Store, buildingId: number, value: number): void {
  const b = store.buildings.byId.get(buildingId)
  if (!b) return
  b.maxOutput = Math.max(0, Math.floor(value))
  afterPanelMutation(store)
}

/** Sets a trading post's per-good storage limit (min reserve or max collection). */
export function setTradingPostLimit(
  store: Store,
  buildingId: number,
  good: string,
  key: 'min' | 'max',
  value: number,
): void {
  const b = store.buildings.byId.get(buildingId)
  if (!b) return
  const cur = b.limits?.[good] ?? { min: tradingPostMin(b, good), max: tradingPostMax(b, good) }
  ;(b.limits ??= {})[good] = { ...cur, [key]: Math.max(0, Math.floor(value)) }
  afterPanelMutation(store)
}

/** Sets a cart's outbound freight. */
export function setCartOutGood(store: Store, cartId: number, good: string): void {
  const c = store.routes.byId.get(cartId)
  if (!c) return
  c.outGood = good
  afterPanelMutation(store)
}

/** Sets a cart's return freight ('' clears it). */
export function setCartReturnGood(store: Store, cartId: number, good: string): void {
  const c = store.routes.byId.get(cartId)
  if (!c) return
  c.returnGood = good === '' ? undefined : good
  afterPanelMutation(store)
}

/** Dissolves a cart (removes it). */
export function removeCart(store: Store, cartId: number): void {
  store.routes.remove(cartId)
  afterPanelMutation(store)
}
