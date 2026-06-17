/**
 * Game store: bundles the render-free simulation systems (from core/) with the
 * camera and a **reactive** display state that the Vue HUD/UI bind to.
 *
 * Intentional separation: the sim objects (world/buildings/economy/routes) and
 * the interaction state (mode/hover/selected) stay **plain** — they are read in
 * the render/logic loop, not by Vue. Only `display` is reactive (scalar values
 * + precomputed info-panel lines) for the DOM. Mirrors GameState from
 * original/, just with a reactive display instead of manual HUD updates.
 */
import { reactive } from '@vue/runtime-dom'
import { Buildings, type BuildingType } from '../core/buildings'
import { Economy } from '../core/economy'
import { generateSettlements, growSettlements, GROWTH } from '../core/npc'
import { Routes, type Treasury } from '../core/routes'
import type { TriCoord } from '../core/tri'
import { World } from '../core/world'
import { Camera } from '../render/camera'
import { START_GELD } from './constants'
import { loadObjectiveCompletions, updateObjectives, type ObjectiveId, type ObjectiveProgress } from './objectives'
import { loadState } from './persistence'

/** What a click on the map does. */
export type Mode =
  | { kind: 'select' }
  | { kind: 'build'; type: BuildingType }
  | { kind: 'route'; fromId: number | null }

/** One cart row in the info panel of a trading post. */
export interface CartRow {
  id: number
  /** e.g. "Wagen → #5" (outbound from here) or "Wagen ← #3" (inbound to here). */
  label: string
  phase: string
  /** True when this trading post is the cart's home — only then is freight selectable. */
  controllable: boolean
  outGood: string
  /** '' = no return freight. */
  returnGood: string
}

/** One storage-limit row (min reserve / max collection) of an own trading post. */
export interface LimitRow {
  good: string
  label: string
  min: number
  max: number
}

/** Worker assignment controls for an own producer in the selected-building panel. */
export interface WorkerRow {
  needed: number
  assigned: number
  target: number
  free: number
}

/** Precomputed info panel of a selected building. Vue renders text lines plus, for
 *  own buildings, interactive controls (workers, max output, storage limits, cart freight). */
export interface SelectionInfo {
  id: number
  title: string
  lines: string[]
  /** Only own buildings (without owner) can be demolished — drives the demolish button. */
  demolishable: boolean
  /** Output good of an own producer (null otherwise) — drives the max-output field. */
  recipeOutput: string | null
  recipeOutputLabel: string
  maxOutput: number
  /** Worker controls of an own producer (null otherwise). */
  workers: WorkerRow | null
  /** Storage limits of an own trading post (empty otherwise). */
  limits: LimitRow[]
  /** Carts whose endpoint is this trading post (empty otherwise). */
  carts: CartRow[]
}

/** Reactive values for HUD/UI. */
export interface Display {
  money: number
  tick: number
  speed: number
  buildings: number
  towns: number
  // What lies under the cursor:
  q: number
  r: number
  terrain: string
  place: string
  // UI state:
  modeId: string // 'select' or BuildingType.id — for the build toolbar highlight
  notice: string
  selection: SelectionInfo | null
  objectives: ObjectiveProgress[]
}

export interface Store {
  readonly world: World
  readonly buildings: Buildings
  readonly economy: Economy
  readonly routes: Routes
  readonly camera: Camera
  readonly treasury: Treasury
  zLevel: number
  speed: number
  tickAccum: number
  // Interaction state (plain):
  mode: Mode
  hover: TriCoord | null
  selected: TriCoord | null
  selectedBuildingId: number | null
  objectiveCompleted: Set<ObjectiveId>
  readonly display: Display
}

function countTowns(buildings: Buildings): number {
  const owners = new Set<string>()
  for (const b of buildings.byId.values()) if (b.owner) owners.add(b.owner)
  return owners.size
}

export function createStore(): Store {
  const world = new World({ min: -3, max: 8 })
  const buildings = new Buildings(world)
  const economy = new Economy(buildings)
  const routes = new Routes(buildings)
  const camera = new Camera()
  const treasury: Treasury = { money: START_GELD }

  // Load an existing save first, then fill in missing NPC settlements —
  // generateSettlements leaves loaded towns and player builds untouched. With
  // an empty localStorage this produces a fresh world.
  loadState(buildings, routes, treasury)
  generateSettlements(buildings)

  const display = reactive<Display>({
    money: treasury.money,
    tick: 0,
    speed: 1,
    buildings: buildings.byId.size,
    towns: countTowns(buildings),
    q: 0,
    r: 0,
    terrain: '—',
    place: '',
    modeId: 'select',
    notice: '',
    selection: null,
    objectives: [],
  })

  const store: Store = {
    world,
    buildings,
    economy,
    routes,
    camera,
    treasury,
    zLevel: 0,
    speed: 1,
    tickAccum: 0,
    mode: { kind: 'select' },
    hover: null,
    selected: null,
    selectedBuildingId: null,
    objectiveCompleted: loadObjectiveCompletions(),
    display,
  }
  updateObjectives(store)
  return store
}

/** Updates the reactive counters (money/buildings/towns) from the sim state. */
export function updateCounters(store: Store): void {
  store.display.money = store.treasury.money
  store.display.buildings = store.buildings.byId.size
  store.display.towns = countTowns(store.buildings)
  updateObjectives(store)
}

/**
 * One economy tick (cf. game.ts: economy → routes → growth). Returns true when
 * the building count changed (settlement grew) — in that case the object layer
 * must be redrawn.
 */
export function tickOnce(store: Store): boolean {
  store.economy.tick()
  store.routes.tick(store.treasury)

  let buildingsChanged = false
  if (store.economy.tickCount % GROWTH.interval === 0) {
    if (growSettlements(store.buildings).length > 0) buildingsChanged = true
  }

  store.display.money = store.treasury.money
  store.display.tick = store.economy.tickCount
  updateObjectives(store)
  if (buildingsChanged) {
    store.display.buildings = store.buildings.byId.size
    store.display.towns = countTowns(store.buildings)
  }
  return buildingsChanged
}
