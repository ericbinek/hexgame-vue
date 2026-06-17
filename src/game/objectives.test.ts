import { describe, expect, it } from 'vitest'
import { Buildings } from '../core/buildings'
import { Routes } from '../core/routes'
import { World } from '../core/world'
import { START_GELD } from './constants'
import {
  OBJECTIVES_KEY,
  computeObjectives,
  loadObjectiveCompletions,
  saveObjectiveCompletions,
  type ObjectiveId,
} from './objectives'
import type { Store } from './store'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function storeFrom(
  entries: Array<{ id?: number; t: string; cells: number[][]; inv?: Record<string, number>; o?: string }>,
  money = START_GELD,
): Store {
  const world = new World()
  const buildings = new Buildings(world)
  buildings.restore(JSON.stringify({ v: 1, buildings: entries.map((entry) => ({ ...entry, z: 0 })) }))
  return {
    world,
    buildings,
    routes: new Routes(buildings),
    treasury: { money },
  } as Store
}

function completedIds(store: Store, completed: ObjectiveId[] = []): ObjectiveId[] {
  return computeObjectives(store, new Set(completed)).filter((o) => o.completed).map((o) => o.id)
}

describe('objectives', () => {
  it('derives early objectives from current game state', () => {
    const store = storeFrom([
      { t: 'tradingPost', cells: [[0, 0]] },
      { t: 'sawmill', cells: [[1, 0]] },
    ])
    expect(completedIds(store)).toEqual(['found-kontor', 'build-sawmill'])
    expect(computeObjectives(store, new Set()).find((o) => o.current)?.id).toBe('produce-bread')
  })

  it('keeps completed objectives complete after transient stock disappears', () => {
    const store = storeFrom([{ t: 'tradingPost', cells: [[0, 0]] }])
    expect(completedIds(store, ['produce-bread'])).toContain('produce-bread')
  })

  it('tracks route, trade and money milestones', () => {
    const store = storeFrom(
      [
        { id: 1, t: 'tradingPost', cells: [[0, 0]] },
        { id: 2, t: 'tradingPost', cells: [[60, 0]], o: 'Eldwik' },
      ],
      1000,
    )
    store.routes.create(1, 2, 'beer')
    expect(completedIds(store)).toEqual(['found-kontor', 'create-route', 'sell-to-town', 'reach-1000'])
  })

  it('saves and loads only known completion ids', () => {
    const storage = new MemoryStorage()
    storage.values.set(OBJECTIVES_KEY, JSON.stringify(['found-kontor', 'unknown']))
    expect([...loadObjectiveCompletions(storage)]).toEqual(['found-kontor'])
    saveObjectiveCompletions(new Set(['create-route']), storage)
    expect(storage.values.get(OBJECTIVES_KEY)).toBe(JSON.stringify(['create-route']))
  })
})
