/**
 * Persistence to localStorage: buildings, carts, money. Each part's format is
 * versioned (buildings/routes.serialize); restore skips the unknown. Saved
 * after every tick and every building action.
 *
 * Own keys (hexgame-vue-*), independent of original/. Cf.
 * original/src/game/persistence.ts. Deliberately takes the individual parts
 * instead of the store, so no import cycle store ↔ persistence arises.
 */
import { Buildings } from '../core/buildings'
import { Routes, type Treasury } from '../core/routes'
import { World } from '../core/world'

const BUILDINGS_KEY = 'hexgame-vue-buildings-v1'
const ROUTES_KEY = 'hexgame-vue-routes-v1'
const MONEY_KEY = 'hexgame-vue-money-v1'

interface SaveBundle {
  v: 1
  buildings: unknown
  routes: unknown
  money: number
}

export type ImportResult = { ok: true } | { ok: false; reason: string }

/** Loads an existing save into the (empty) systems. Errors are non-fatal. */
export function loadState(buildings: Buildings, routes: Routes, treasury: Treasury): void {
  try {
    const saved = localStorage.getItem(BUILDINGS_KEY)
    if (saved) buildings.restore(saved)
  } catch (err) {
    console.warn('Spielstand konnte nicht geladen werden:', err)
  }
  try {
    const savedRoutes = localStorage.getItem(ROUTES_KEY)
    if (savedRoutes) routes.restore(savedRoutes)
  } catch (err) {
    console.warn('Routen konnten nicht geladen werden:', err)
  }
  try {
    const money = Number.parseInt(localStorage.getItem(MONEY_KEY) ?? '', 10)
    if (Number.isFinite(money)) treasury.money = money
  } catch (err) {
    console.warn('Geldstand konnte nicht geladen werden:', err)
  }
}

export function save(buildings: Buildings, routes: Routes, treasury: Treasury): void {
  try {
    localStorage.setItem(BUILDINGS_KEY, buildings.serialize())
    localStorage.setItem(ROUTES_KEY, routes.serialize())
    localStorage.setItem(MONEY_KEY, String(treasury.money))
  } catch (err) {
    console.warn('Spielstand konnte nicht gespeichert werden:', err)
  }
}

export function exportSavedState(buildings: Buildings, routes: Routes, treasury: Treasury): string {
  const bundle: SaveBundle = {
    v: 1,
    buildings: JSON.parse(buildings.serialize()) as unknown,
    routes: JSON.parse(routes.serialize()) as unknown,
    money: treasury.money,
  }
  return JSON.stringify(bundle, null, 2)
}

function parseImport(json: string): { ok: true; bundle: SaveBundle } | { ok: false; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'kein gültiges JSON' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'kein Spielstand' }
  const bundle = parsed as Partial<SaveBundle>
  if (bundle.v !== 1) return { ok: false, reason: 'unbekannte Spielstand-Version' }
  if (bundle.buildings === undefined || bundle.routes === undefined) {
    return { ok: false, reason: 'Gebäude oder Routen fehlen' }
  }
  if (!Number.isFinite(bundle.money)) return { ok: false, reason: 'Geldstand fehlt' }
  return { ok: true, bundle: bundle as SaveBundle }
}

export function importSavedState(json: string, storage: Pick<Storage, 'setItem'> = localStorage): ImportResult {
  const parsed = parseImport(json)
  if (!parsed.ok) return parsed

  const buildingsJson = JSON.stringify(parsed.bundle.buildings)
  const routesJson = JSON.stringify(parsed.bundle.routes)
  try {
    const world = new World()
    const buildings = new Buildings(world)
    buildings.restore(buildingsJson)
    const routes = new Routes(buildings)
    routes.restore(routesJson)
  } catch {
    return { ok: false, reason: 'Spielstand konnte nicht gelesen werden' }
  }

  try {
    storage.setItem(BUILDINGS_KEY, buildingsJson)
    storage.setItem(ROUTES_KEY, routesJson)
    storage.setItem(MONEY_KEY, String(Math.floor(parsed.bundle.money)))
  } catch {
    return { ok: false, reason: 'Spielstand konnte nicht gespeichert werden' }
  }
  return { ok: true }
}

/** Discard the save (for restart / tests). */
export function discardState(): void {
  localStorage.removeItem(BUILDINGS_KEY)
  localStorage.removeItem(ROUTES_KEY)
  localStorage.removeItem(MONEY_KEY)
}
