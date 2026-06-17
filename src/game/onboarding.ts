import type { Store } from './store'

export const GUIDE_KEY = 'hexgame-vue-first-build-guide-v1'

export interface GuideStep {
  id: string
  title: string
  text: string
  modeId: string
}

const STEPS: GuideStep[] = [
  {
    id: 'found-kontor',
    title: 'Kontor gründen',
    text: 'Kontor wählen und auf baubares Land setzen.',
    modeId: 'tradingPost',
  },
  {
    id: 'build-sawmill',
    title: 'Gründungsholz nutzen',
    text: 'Sägewerk in Kontor-Reichweite bauen.',
    modeId: 'sawmill',
  },
  {
    id: 'build-farm',
    title: 'Nahrung starten',
    text: 'Hof nahe bei Wohnhäusern und Kontor bauen.',
    modeId: 'farm',
  },
  {
    id: 'build-mill',
    title: 'Korn verarbeiten',
    text: 'Mühle ergänzt die Brot-Kette.',
    modeId: 'mill',
  },
  {
    id: 'build-bakery',
    title: 'Brot backen',
    text: 'Bäckerei versorgt Häuser mit Brot.',
    modeId: 'bakery',
  },
]

function hasOwn(store: Store, typeId: string): boolean {
  for (const b of store.buildings.byId.values()) {
    if (b.owner === undefined && b.typeId === typeId) return true
  }
  return false
}

export function firstBuildGuideStep(store: Store): GuideStep | null {
  if (!hasOwn(store, 'tradingPost')) return STEPS[0]
  if (!hasOwn(store, 'sawmill')) return STEPS[1]
  if (!hasOwn(store, 'farm')) return STEPS[2]
  if (!hasOwn(store, 'mill')) return STEPS[3]
  if (!hasOwn(store, 'bakery')) return STEPS[4]
  return null
}

function browserStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export function loadGuideDismissed(storage: Pick<Storage, 'getItem'> | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    return storage.getItem(GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveGuideDismissed(done: boolean, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(GUIDE_KEY, done ? '1' : '0')
  } catch {
    // The guide is optional; ignore blocked localStorage.
  }
}
