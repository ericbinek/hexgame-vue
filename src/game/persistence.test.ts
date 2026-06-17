import { describe, expect, it } from 'vitest'
import { Buildings } from '../core/buildings'
import { Routes } from '../core/routes'
import { World } from '../core/world'
import { exportSavedState, importSavedState } from './persistence'

class MemoryStorage {
  readonly values = new Map<string, string>()

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function systems() {
  const world = new World()
  const buildings = new Buildings(world)
  buildings.restore(JSON.stringify({
    v: 1,
    buildings: [{ id: 1, t: 'tradingPost', z: 0, cells: [[0, 0]] }],
  }))
  const tradingPost = buildings.byId.get(1)!
  tradingPost.inv = { wood: 7 }
  return { buildings, routes: new Routes(buildings), treasury: { money: 123 } }
}

describe('save import/export', () => {
  it('exports a complete JSON save bundle and imports it into storage', () => {
    const { buildings, routes, treasury } = systems()
    const json = exportSavedState(buildings, routes, treasury)
    const storage = new MemoryStorage()
    expect(importSavedState(json, storage).ok).toBe(true)
    expect([...storage.values.keys()].sort()).toEqual([
      'hexgame-vue-buildings-v1',
      'hexgame-vue-money-v1',
      'hexgame-vue-routes-v1',
    ])
    expect(storage.values.get('hexgame-vue-money-v1')).toBe('123')
  })

  it('rejects invalid JSON without writing to storage', () => {
    const storage = new MemoryStorage()
    storage.setItem('existing', 'keep')
    const result = importSavedState('{ nope', storage)
    expect(result.ok).toBe(false)
    expect(storage.values.size).toBe(1)
    expect(storage.values.get('existing')).toBe('keep')
  })

  it('rejects incomplete save bundles', () => {
    const storage = new MemoryStorage()
    const result = importSavedState(JSON.stringify({ v: 1, buildings: {}, money: 10 }), storage)
    expect(result.ok).toBe(false)
    expect(storage.values.size).toBe(0)
  })
})
