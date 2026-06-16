import { describe, expect, it } from 'vitest'
import { hexTriangles, triToHex } from '../core/hex'
import { pointToTri, triCentroid } from '../core/tri'
import { Camera } from './camera'
import { tierForScale, drawMap } from './map'

/** Minimal CanvasRenderingContext2D stand-in that only counts calls. */
function mockCtx() {
  let fills = 0
  let strokes = 0
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() { fills++ },
    stroke() { strokes++ },
    setTransform() {},
    fillRect() {},
    get fills() { return fills },
    get strokes() { return strokes },
  }
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
