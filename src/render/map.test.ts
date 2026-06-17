import { describe, expect, it } from 'vitest'
import { BUILDING_TYPES } from '../core/buildings'
import { Buildings } from '../core/buildings'
import { Economy } from '../core/economy'
import { hexTriangles, triToHex } from '../core/hex'
import { Routes } from '../core/routes'
import { pointToTri, triCentroid } from '../core/tri'
import { World } from '../core/world'
import type { Store } from '../game/store'
import { Camera } from './camera'
import { tierForScale, drawMap, drawOverlay } from './map'

/** Minimal CanvasRenderingContext2D stand-in that only counts calls. */
function mockCtx() {
  let fills = 0
  let strokes = 0
  const texts: string[] = []
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() { fills++ },
    stroke() { strokes++ },
    strokeText(text: string) { texts.push(text) },
    fillText(text: string) { texts.push(text) },
    setTransform() {},
    fillRect() {},
    strokeRect() {},
    get fills() { return fills },
    get strokes() { return strokes },
    get texts() { return texts },
  }
}

function testStore(parts: Partial<Store>): Store {
  const world = new World()
  const buildings = new Buildings(world)
  return {
    world,
    buildings,
    routes: new Routes(buildings),
    zLevel: 0,
    mode: { kind: 'select' },
    hover: null,
    selected: null,
    selectedBuildingId: null,
    ...parts,
  } as Store
}

describe('Camera', () => {
  it('screenToWorld and worldToScreen are inverses', () => {
    const cam = new Camera()
    cam.setViewport(800, 600)
    cam.cx = 3
    cam.cy = -2
    cam.scale = 32
    const w = cam.screenToWorld(123, 456)
    const s = cam.worldToScreen(w.x, w.y)
    expect(Math.abs(s.x - 123)).toBeLessThan(1e-6)
    expect(Math.abs(s.y - 456)).toBeLessThan(1e-6)
  })

  it('screen center is the camera center', () => {
    const cam = new Camera()
    cam.setViewport(800, 600)
    cam.cx = 5
    cam.cy = 7
    const w = cam.screenToWorld(400, 300)
    expect(Math.abs(w.x - 5)).toBeLessThan(1e-9)
    expect(Math.abs(w.y - 7)).toBeLessThan(1e-9)
  })

  it('visibleRect encloses the center', () => {
    const cam = new Camera()
    cam.setViewport(800, 600)
    const r = cam.visibleRect()
    expect(r.minX).toBeLessThan(cam.cx)
    expect(r.maxX).toBeGreaterThan(cam.cx)
    expect(r.minY).toBeLessThan(cam.cy)
    expect(r.maxY).toBeGreaterThan(cam.cy)
  })
})

describe('tierForScale', () => {
  it('tiers by zoom', () => {
    expect(tierForScale(8)).toBe(0)
    expect(tierForScale(16)).toBe(1)
    expect(tierForScale(48)).toBe(2)
    expect(tierForScale(640)).toBe(2)
  })
})

describe('drawMap', () => {
  it('draws visible cells (detail LOD)', () => {
    const cam = new Camera()
    cam.setViewport(800, 600)
    cam.scale = 48
    const ctx = mockCtx()
    drawMap(ctx as unknown as CanvasRenderingContext2D, cam)
    expect(ctx.fills).toBeGreaterThan(0)
    expect(ctx.strokes).toBeGreaterThan(0)
  })

  it('also draws at far zoom (hex LOD, no outlines)', () => {
    const cam = new Camera()
    cam.setViewport(800, 600)
    cam.scale = 8
    const ctx = mockCtx()
    drawMap(ctx as unknown as CanvasRenderingContext2D, cam)
    expect(ctx.fills).toBeGreaterThan(0)
    expect(ctx.strokes).toBe(0) // Tier 0: faces only
  })

  it('bundles faces by terrain color (≤ 7 fills, regardless of hex count)', () => {
    // A large viewport at far zoom = thousands of hexes. Thanks to color batching
    // the number of fill() calls must still not exceed the 7 terrain types —
    // otherwise a fill-per-hex would have crept back in.
    const cam = new Camera()
    cam.setViewport(4000, 3000)
    cam.scale = 8
    const ctx = mockCtx()
    drawMap(ctx as unknown as CanvasRenderingContext2D, cam)
    expect(ctx.fills).toBeGreaterThan(0)
    expect(ctx.fills).toBeLessThanOrEqual(7)
  })
})

describe('drawOverlay planning hints', () => {
  it('draws the trading post collection radius while placing a Kontor', () => {
    const cam = new Camera()
    cam.scale = 48
    const type = BUILDING_TYPES.find((t) => t.id === 'tradingPost')!
    const store = testStore({ mode: { kind: 'build', type }, hover: { x: 0, y: 0 } })
    const ctx = mockCtx()
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, cam, store)
    expect(ctx.fills).toBeGreaterThan(1) // radius fill + build ghost
    expect(ctx.texts).toContain('Kontor-Reichweite')
  })

  it('shows invalid build reasons on the build preview', () => {
    const cam = new Camera()
    cam.scale = 48
    const type = BUILDING_TYPES.find((t) => t.id === 'house')!
    const store = testStore({ zLevel: 1, mode: { kind: 'build', type }, hover: { x: 0, y: 0 } })
    const ctx = mockCtx()
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, cam, store)
    expect(ctx.texts).toContain('keine tragende Ebene darunter')
  })

  it('previews route distance and travel ticks while choosing a cart target', () => {
    const world = new World()
    const buildings = new Buildings(world)
    buildings.restore(JSON.stringify({
      v: 1,
      buildings: [
        { id: 1, t: 'tradingPost', z: 0, cells: [[0, 0]] },
        { id: 2, t: 'tradingPost', z: 0, cells: [[60, 0]] },
      ],
    }))
    const store = testStore({
      world,
      buildings,
      routes: new Routes(buildings),
      mode: { kind: 'route', fromId: 1 },
      hover: { x: 60, y: 0 },
    })
    const ctx = mockCtx()
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, new Camera(), store)
    expect(ctx.texts.some((text) => text.includes('Ticks'))).toBe(true)
  })

  it('draws map status badges for blocked own producers', () => {
    const world = new World()
    const buildings = new Buildings(world)
    buildings.restore(JSON.stringify({
      v: 1,
      buildings: [{ id: 1, t: 'sawmill', z: 0, cells: [[0, 0]], inv: { wood: 8 } }],
    }))
    const store = testStore({
      world,
      buildings,
      economy: new Economy(buildings),
      routes: new Routes(buildings),
    })
    const ctx = mockCtx()
    const cam = new Camera()
    cam.scale = 48
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, cam, store)
    expect(ctx.texts).toContain('Voll')
  })

  it('draws building type markers only at readable zoom levels', () => {
    const world = new World()
    const buildings = new Buildings(world)
    buildings.restore(JSON.stringify({
      v: 1,
      buildings: [{ id: 1, t: 'tradingPost', z: 0, cells: [[0, 0]] }],
    }))
    const store = testStore({
      world,
      buildings,
      economy: new Economy(buildings),
      routes: new Routes(buildings),
    })
    const far = mockCtx()
    const farCam = new Camera()
    farCam.scale = 20
    drawOverlay(far as unknown as CanvasRenderingContext2D, farCam, store)
    expect(far.texts).not.toContain('K')

    const readable = mockCtx()
    const readableCam = new Camera()
    readableCam.scale = 36
    drawOverlay(readable as unknown as CanvasRenderingContext2D, readableCam, store)
    expect(readable.texts).toContain('K')
  })

  it('draws active route cart labels with load and direction', () => {
    const world = new World()
    const buildings = new Buildings(world)
    buildings.restore(JSON.stringify({
      v: 1,
      buildings: [
        { id: 1, t: 'tradingPost', z: 0, cells: [[0, 0]], inv: { beer: 8 } },
        { id: 2, t: 'tradingPost', z: 0, cells: [[60, 0]], o: 'Eldwik' },
      ],
    }))
    const routes = new Routes(buildings)
    const res = routes.create(1, 2, 'beer')
    if (!res.ok) throw new Error(res.reason)
    routes.tick()
    const store = testStore({
      world,
      buildings,
      economy: new Economy(buildings),
      routes,
    })
    const ctx = mockCtx()
    const cam = new Camera()
    cam.scale = 48
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, cam, store)
    expect(ctx.texts).toContain('→ 8 Bier')
  })
})

describe('picking consistency (geometry ↔ hex)', () => {
  it('triangle centroid maps back to the same triangle and hex', () => {
    for (const [q, r] of [[0, 0], [3, -1], [-2, 4], [5, 5]] as const) {
      for (const tri of hexTriangles(q, r)) {
        const c = triCentroid(tri.x, tri.y)
        const back = pointToTri(c.x, c.y)
        expect(back.x).toBe(tri.x)
        expect(back.y).toBe(tri.y)
        expect(triToHex(tri.x, tri.y)).toEqual({ q, r })
      }
    }
  })
})
