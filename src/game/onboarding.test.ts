import { describe, expect, it } from 'vitest'
import { Buildings } from '../core/buildings'
import { World } from '../core/world'
import { firstBuildGuideStep, loadGuideDismissed, saveGuideDismissed, type GuideStep } from './onboarding'
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

function storeWith(types: string[]): Store {
  const world = new World()
  const buildings = new Buildings(world)
  buildings.restore(JSON.stringify({
    v: 1,
    buildings: types.map((t, i) => ({ id: i + 1, t, z: 0, cells: [[i, 0]] })),
  }))
  return { world, buildings } as Store
}

function step(types: string[]): GuideStep | null {
  return firstBuildGuideStep(storeWith(types))
}

describe('firstBuildGuideStep', () => {
  it('advances from Kontor to the first food-chain buildings from current state', () => {
    expect(step([])?.modeId).toBe('tradingPost')
    expect(step(['tradingPost'])?.modeId).toBe('sawmill')
    expect(step(['tradingPost', 'sawmill'])?.modeId).toBe('farm')
    expect(step(['tradingPost', 'sawmill', 'farm'])?.modeId).toBe('mill')
    expect(step(['tradingPost', 'sawmill', 'farm', 'mill'])?.modeId).toBe('bakery')
    expect(step(['tradingPost', 'sawmill', 'farm', 'mill', 'bakery'])).toBeNull()
  })

  it('persists dismissal state', () => {
    const storage = new MemoryStorage()
    expect(loadGuideDismissed(storage)).toBe(false)
    saveGuideDismissed(true, storage)
    expect(loadGuideDismissed(storage)).toBe(true)
  })
})
