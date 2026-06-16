/**
 * Persistence to localStorage: buildings, carts, money. Each part's format is
 * versioned (buildings/routes.serialize); restore skips the unknown. Saved
 * after every tick and every building action.
 *
 * Own keys (hexgame-vue-*), independent of original/. Cf.
 * original/src/game/persistence.ts. Deliberately takes the individual parts
 * instead of the store, so no import cycle store ↔ persistence arises.
 */
import type { Buildings } from '../core/buildings'
import type { Routes, Treasury } from '../core/routes'

const BUILDINGS_KEY = 'hexgame-vue-buildings-v1'
const ROUTES_KEY = 'hexgame-vue-routes-v1'
const MONEY_KEY = 'hexgame-vue-money-v1'

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
  const money = Number.parseInt(localStorage.getItem(MONEY_KEY) ?? '', 10)
  if (Number.isFinite(money)) treasury.money = money
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

/** Discard the save (for restart / tests). */
export function discardState(): void {
  localStorage.removeItem(BUILDINGS_KEY)
  localStorage.removeItem(ROUTES_KEY)
  localStorage.removeItem(MONEY_KEY)
}
