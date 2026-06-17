import { describe, expect, it } from 'vitest'
import { Buildings } from '../core/buildings'
import { Economy } from '../core/economy'
import { Routes } from '../core/routes'
import { World } from '../core/world'
import { buildingMapStatus } from './status'
import type { Store } from './store'

function storeWith(entries: Array<{ id?: number; t: string; cells: number[][]; inv?: Record<string, number>; m?: number }>): Store {
  const world = new World()
  const buildings = new Buildings(world)
  buildings.restore(JSON.stringify({ v: 1, buildings: entries.map((entry) => ({ ...entry, z: 0 })) }))
  return {
    world,
    buildings,
    economy: new Economy(buildings),
    routes: new Routes(buildings),
  } as Store
}

describe('buildingMapStatus', () => {
  it('flags producers due for maintenance first', () => {
    const store = storeWith([{ id: 1, t: 'sawmill', cells: [[0, 0]], inv: { wood: 8 }, m: 1 }])
    expect(buildingMapStatus(store, store.buildings.byId.get(1)!)?.kind).toBe('maintenance')
  })

  it('flags full output buffers', () => {
    const store = storeWith([{ id: 1, t: 'sawmill', cells: [[0, 0]], inv: { wood: 8 } }])
    expect(buildingMapStatus(store, store.buildings.byId.get(1)!)?.label).toBe('Voll')
  })

  it('flags missing workers after the economy has ticked', () => {
    const store = storeWith([{ id: 1, t: 'sawmill', cells: [[0, 0]] }])
    store.economy.tick()
    expect(buildingMapStatus(store, store.buildings.byId.get(1)!)?.kind).toBe('workers')
  })

  it('flags missing input goods', () => {
    const store = storeWith([
      { id: 1, t: 'house', cells: [[0, 0]] },
      { id: 2, t: 'brewery', cells: [[1, 0]] },
    ])
    expect(buildingMapStatus(store, store.buildings.byId.get(2)!)?.kind).toBe('input')
  })

  it('flags full trading post storage', () => {
    const store = storeWith([{ id: 1, t: 'tradingPost', cells: [[0, 0]], inv: { wood: 40 } }])
    expect(buildingMapStatus(store, store.buildings.byId.get(1)!)?.label).toBe('Lager')
  })
})
