import { typeById } from './core/buildings'
import { TICK_MS } from './core/economy'
import { triToHex } from './core/hex'
import { terrainAt } from './core/terrain'
import { pointToTri, triCentroid, type TriCoord } from './core/tri'
import { save, discardState } from './game/persistence'
import { updateSelection, clickMap, setMode, setNotice, setSpeed } from './game/operations'
import { createStore, tickOnce } from './game/store'
import { drawMap, drawLabels, drawObjects, drawOverlay } from './render/map'
import { installUi } from './ui/hud'

// --- Store + Canvas ---------------------------------------------------------
const store = createStore()
const cam = store.camera
const a = store.display

const canvas = document.getElementById('map') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
let dirty = true

// Start over a settlement — the NPC villages sit far from the origin.
const startTradingPost = [...store.buildings.byId.values()].find((b) => b.typeId === 'tradingPost')
if (startTradingPost) {
  const c = triCentroid(startTradingPost.cells[0].x, startTradingPost.cells[0].y)
  cam.cx = c.x
  cam.cy = c.y
}

function resize() {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
  cam.setViewport(window.innerWidth, window.innerHeight)
  dirty = true
}
window.addEventListener('resize', resize)
resize()

function triUnder(sx: number, sy: number): TriCoord {
  const w = cam.screenToWorld(sx, sy)
  return pointToTri(w.x, w.y)
}

function render() {
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#0c1622' // deep water as background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  cam.applyToCanvas(ctx, dpr)
  drawMap(ctx, cam) // terrain
  drawObjects(ctx, cam, store.world, store.zLevel) // buildings
  drawOverlay(ctx, cam, store) // preview / selection / hover
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // screen space for text
  drawLabels(ctx, cam, store.buildings) // settlement names
}

// --- Render/tick loop -------------------------------------------------------
let last = performance.now()
function frame(now: number) {
  const dt = now - last
  last = now

  store.tickAccum += dt * store.speed
  let ticked = false
  while (store.tickAccum >= TICK_MS) {
    store.tickAccum -= TICK_MS
    if (tickOnce(store)) dirty = true // settlement grew
    ticked = true
  }
  if (ticked) {
    // Refresh the selected building's info panel each tick (stocks are live).
    if (store.selectedBuildingId !== null) updateSelection(store)
    // Save the game state after each tick (cf. game.ts: save() after tick).
    save(store.buildings, store.routes, store.treasury)
  }

  if (cam.update(dt)) dirty = true
  if (dirty) {
    render()
    dirty = false
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// --- Input (pointer events: mouse + touch, with pinch-to-zoom) --------------
const pointers = new Map<number, { x: number; y: number }>()
let dragDistance = 0

// Updates the hover readout (hex/terrain/building under the cursor).
function updateHover(clientX: number, clientY: number): void {
  const tri = triUnder(clientX, clientY)
  store.hover = tri
  const hex = triToHex(tri.x, tri.y)
  a.q = hex.q
  a.r = hex.r
  a.terrain = terrainAt(hex.q, hex.r).name
  const b = store.buildings.at(tri.x, tri.y, store.zLevel)
  a.place = b ? `${typeById(b.typeId)?.name ?? b.typeId}${b.owner ? ` · ${b.owner}` : ''}` : ''
  dirty = true
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return // right-click is handled by contextmenu (→ pointer mode)
  try {
    canvas.setPointerCapture(e.pointerId)
  } catch {
    // No active pointer (e.g. synthetic events) — capture is optional.
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  dragDistance = 0
  canvas.style.cursor = 'grabbing'
})

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId)
  if (!prev) {
    updateHover(e.clientX, e.clientY) // not dragging → just hover
    return
  }
  if (pointers.size === 2) {
    // Two fingers: pan by the midpoint shift and zoom by the distance ratio.
    const ids = [...pointers.keys()]
    const a0 = pointers.get(ids[0])!
    const b0 = pointers.get(ids[1])!
    const oldDist = Math.hypot(a0.x - b0.x, a0.y - b0.y)
    const oldMid = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const a1 = pointers.get(ids[0])!
    const b1 = pointers.get(ids[1])!
    const newDist = Math.hypot(a1.x - b1.x, a1.y - b1.y)
    const newMid = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }
    cam.panPixels(newMid.x - oldMid.x, newMid.y - oldMid.y)
    if (oldDist > 0) cam.pinchBy(newDist / oldDist, newMid.x, newMid.y)
    dragDistance = Infinity // a pinch is never a click
    dirty = true
    return
  }
  cam.panPixels(e.clientX - prev.x, e.clientY - prev.y)
  dragDistance += Math.hypot(e.clientX - prev.x, e.clientY - prev.y)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  dirty = true
})

function endPointer(e: PointerEvent): void {
  const wasTracked = pointers.delete(e.pointerId)
  canvas.style.cursor = 'grab'
  // A click (not a drag/pinch) builds or selects.
  if (!wasTracked || pointers.size > 0 || dragDistance >= 6) return
  clickMap(store, triUnder(e.clientX, e.clientY))
  dirty = true
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', (e) => {
  pointers.delete(e.pointerId)
})
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  // Right-click cancels build mode and returns to the pointer.
  // (Demolish runs via the button in the info panel, no longer via right-click.)
  setMode(store, { kind: 'select' })
  dirty = true
})
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    cam.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
    dirty = true
  },
  { passive: false },
)
canvas.style.cursor = 'grab'

function layerName(z: number): string {
  return z === 0 ? 'EG' : z > 0 ? `OG ${z}` : `UG ${-z}`
}

// Switch the active build level (basement / ground floor / upper floors).
function changeLayer(dz: number): void {
  const nz = store.world.clampZ(store.zLevel + dz)
  if (nz === store.zLevel) return
  store.zLevel = nz
  setNotice(store, `Ebene: ${layerName(nz)}`)
  dirty = true
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') setSpeed(store, store.speed === 0 ? 1 : 0)
  else if (e.key === '1') setSpeed(store, 1)
  else if (e.key === '2') setSpeed(store, 2)
  else if (e.key === '3') setSpeed(store, 4)
  else if (e.key === 'PageUp' || e.key === 'e' || e.key === 'E') changeLayer(1)
  else if (e.key === 'PageDown' || e.key === 'q' || e.key === 'Q') changeLayer(-1)
  else if (e.key === 'Escape') setMode(store, { kind: 'select' })
  else return
  e.preventDefault()
})

// --- Mount UI ---------------------------------------------------------------
// The UI may request a redraw of the map (e.g. after demolish from the info panel).
installUi(store, () => {
  dirty = true
})

// Debug access for console/smoke test (cf. window.__hexgame in original/).
;(window as unknown as { __hexgame: unknown }).__hexgame = {
  store,
  /** Builds typeId at triangle (x,y) through the real click path. */
  build(typeId: string, x: number, y: number): boolean {
    const type = typeById(typeId)
    if (!type) return false
    setMode(store, { kind: 'build', type })
    const ok = clickMap(store, { x, y })
    dirty = true
    return ok
  },
  /** Discard the game state (reload then starts fresh). */
  reset: discardState,
}
