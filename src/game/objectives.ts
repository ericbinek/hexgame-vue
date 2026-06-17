import { stockOf } from '../core/economy'
import { START_GELD } from './constants'
import type { Store } from './store'

export const OBJECTIVES_KEY = 'hexgame-vue-objectives-v1'

export type ObjectiveId =
  | 'found-kontor'
  | 'build-sawmill'
  | 'produce-bread'
  | 'create-route'
  | 'sell-to-town'
  | 'reach-1000'

export interface ObjectiveProgress {
  id: ObjectiveId
  label: string
  completed: boolean
  current: boolean
}

interface Objective {
  id: ObjectiveId
  label: string
  done: (store: Store) => boolean
}

const OBJECTIVES: Objective[] = [
  {
    id: 'found-kontor',
    label: 'Kontor gründen',
    done: (store) => hasOwnBuilding(store, 'tradingPost'),
  },
  {
    id: 'build-sawmill',
    label: 'Sägewerk bauen',
    done: (store) => hasOwnBuilding(store, 'sawmill'),
  },
  {
    id: 'produce-bread',
    label: 'Brot produzieren',
    done: (store) => ownBuildings(store).some((b) => stockOf(b, 'bread') > 0),
  },
  {
    id: 'create-route',
    label: 'Wagenroute anlegen',
    done: (store) => store.routes.byId.size > 0,
  },
  {
    id: 'sell-to-town',
    label: 'Ware an einen Ort verkaufen',
    done: (store) => store.treasury.money > START_GELD,
  },
  {
    id: 'reach-1000',
    label: '1.000 Geld erreichen',
    done: (store) => store.treasury.money >= 1000,
  },
]

function ownBuildings(store: Store) {
  return [...store.buildings.byId.values()].filter((b) => b.owner === undefined)
}

function hasOwnBuilding(store: Store, typeId: string): boolean {
  return ownBuildings(store).some((b) => b.typeId === typeId)
}

function browserStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export function loadObjectiveCompletions(storage: Pick<Storage, 'getItem'> | null = browserStorage()): Set<ObjectiveId> {
  if (!storage) return new Set()
  try {
    const raw = storage.getItem(OBJECTIVES_KEY)
    if (!raw) return new Set()
    const ids = JSON.parse(raw) as unknown
    if (!Array.isArray(ids)) return new Set()
    return new Set(ids.filter((id): id is ObjectiveId => OBJECTIVES.some((o) => o.id === id)))
  } catch {
    return new Set()
  }
}

export function saveObjectiveCompletions(
  completed: ReadonlySet<ObjectiveId>,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(OBJECTIVES_KEY, JSON.stringify([...completed]))
  } catch {
    // Progress hints are non-critical; the game state itself is saved elsewhere.
  }
}

export function computeObjectives(store: Store, completed: ReadonlySet<ObjectiveId>): ObjectiveProgress[] {
  const nextCompleted = new Set(completed)
  for (const objective of OBJECTIVES) {
    if (objective.done(store)) nextCompleted.add(objective.id)
  }
  const firstOpen = OBJECTIVES.find((objective) => !nextCompleted.has(objective.id))?.id ?? null
  return OBJECTIVES.map((objective) => ({
    id: objective.id,
    label: objective.label,
    completed: nextCompleted.has(objective.id),
    current: objective.id === firstOpen,
  }))
}

export function updateObjectives(store: Store): void {
  const before = store.objectiveCompleted.size
  const progress = computeObjectives(store, store.objectiveCompleted)
  store.objectiveCompleted = new Set(progress.filter((o) => o.completed).map((o) => o.id))
  store.display.objectives = progress
  if (store.objectiveCompleted.size !== before) saveObjectiveCompletions(store.objectiveCompleted)
}
