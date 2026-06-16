/**
 * Camera over the world map. `scale` = screen pixels (CSS) per world length unit
 * (one triangle side = 1 world unit). World coordinates have the y-axis pointing
 * up, the canvas pointing down — applyToCanvas() performs the flip.
 *
 * Ported from original/src/render/camera.ts; the only difference: instead of
 * applyTo(pixiContainer), applyToCanvas(ctx) sets the 2D transformation matrix.
 */
export class Camera {
  static readonly MIN_SCALE = 8;
  static readonly MAX_SCALE = 640;

  cx = 0;
  cy = 0;
  scale = 48;

  private targetScale = 48;
  private anchor: { sx: number; sy: number } | null = null;
  private w = 1;
  private h = 1;

  setViewport(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.w / 2) / this.scale + this.cx,
      y: this.cy - (sy - this.h / 2) / this.scale,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.cx) * this.scale + this.w / 2,
      y: (this.cy - wy) * this.scale + this.h / 2,
    };
  }

  panPixels(dx: number, dy: number): void {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  /** Smooth zoom (mouse wheel): set the target, update() animates toward it. */
  zoomBy(factor: number, sx: number, sy: number): void {
    this.targetScale = clamp(this.targetScale * factor, Camera.MIN_SCALE, Camera.MAX_SCALE);
    this.anchor = { sx, sy };
  }

  /** Direct zoom (pinch): apply immediately, the point under the fingers stays fixed. */
  pinchBy(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.scale = clamp(this.scale * factor, Camera.MIN_SCALE, Camera.MAX_SCALE);
    this.targetScale = this.scale;
    const after = this.screenToWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  /** Animates the smooth zoom. Returns true as long as something is still changing. */
  update(dtMs: number): boolean {
    if (Math.abs(this.targetScale - this.scale) < 1e-3) {
      this.anchor = null;
      return false;
    }
    const a = this.anchor ?? { sx: this.w / 2, sy: this.h / 2 };
    const before = this.screenToWorld(a.sx, a.sy);
    const k = 1 - Math.exp(-dtMs * 0.012);
    this.scale += (this.targetScale - this.scale) * k;
    if (Math.abs(this.targetScale - this.scale) < 0.01) this.scale = this.targetScale;
    const after = this.screenToWorld(a.sx, a.sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    return true;
  }

  visibleRect(): { minX: number; maxX: number; minY: number; maxY: number } {
    const hw = this.w / (2 * this.scale);
    const hh = this.h / (2 * this.scale);
    return { minX: this.cx - hw, maxX: this.cx + hw, minY: this.cy - hh, maxY: this.cy + hh };
  }

  /**
   * Sets the canvas 2D transform: world coordinates → device pixels.
   * `dpr` (devicePixelRatio) scales the backbuffer for crisp rendering;
   * camera dimensions (w/h) stay in CSS pixels.
   */
  applyToCanvas(ctx: CanvasRenderingContext2D, dpr = 1): void {
    const s = this.scale * dpr;
    ctx.setTransform(
      s, 0, 0, -s,
      (this.w / 2 - this.cx * this.scale) * dpr,
      (this.h / 2 + this.cy * this.scale) * dpr,
    );
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
