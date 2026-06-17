import type { Building } from '../core/buildings'
import {
  GOODS,
  RECIPES,
  maxOutputOf,
  stockOf,
  tradingPostCapacity,
  tradingPostMax,
  tradingPostVolumeUsed,
} from '../core/economy'
import type { Store } from './store'

export type MapStatusKind = 'maintenance' | 'workers' | 'input' | 'output' | 'storage'

export interface MapStatus {
  kind: MapStatusKind
  label: string
  title: string
}

export function buildingMapStatus(store: Store, building: Building): MapStatus | null {
  if (building.owner !== undefined) return null
  if (building.typeId === 'tradingPost') return tradingPostStatus(store, building)

  const recipe = RECIPES[building.typeId]
  if (!recipe) return null
  if (building.needsMaintenance) {
    return { kind: 'maintenance', label: 'Wartung', title: 'Wartung fällig: braucht 1 Holz im Kontor' }
  }
  const out = stockOf(building, recipe.output)
  const max = maxOutputOf(building)
  if (out >= max) {
    return { kind: 'output', label: 'Voll', title: `${GOODS[recipe.output] ?? recipe.output} voll (${out}/${max})` }
  }
  if (store.economy.tickCount > 0 && !store.economy.isActive(building)) {
    return { kind: 'workers', label: 'Arbeiter', title: 'Keine Arbeiter in Reichweite' }
  }
  for (const [good, qty] of Object.entries(recipe.inputs ?? {})) {
    if (stockOf(building, good) < qty) {
      return { kind: 'input', label: GOODS[good] ?? good, title: `Wartet auf ${GOODS[good] ?? good}` }
    }
  }
  return null
}

function tradingPostStatus(store: Store, building: Building): MapStatus | null {
  const used = tradingPostVolumeUsed(building)
  const cap = tradingPostCapacity(store.buildings, building)
  if (used >= cap) {
    return { kind: 'storage', label: 'Lager', title: `Lager voll (${Math.round(used)}/${cap} m³)` }
  }
  for (const [good, label] of Object.entries(GOODS)) {
    const stock = stockOf(building, good)
    if (stock > 0 && stock >= tradingPostMax(building, good)) {
      return { kind: 'storage', label: 'Limit', title: `${label} am Sammel-Limit (${stock})` }
    }
  }
  return null
}
