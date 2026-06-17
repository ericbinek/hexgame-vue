# Render Profiling

The Canvas renderer is still immediate-mode. Do not add chunk caching until a measured scenario shows the current renderer is the bottleneck.

## Capture A Baseline

1. Start the app with `pnpm dev`.
2. Open `http://127.0.0.1:8000/?profile=1`.
3. Pan and zoom through representative scenes: far terrain view, medium town view, close triangle view, and a dense player build area.
4. In DevTools, run:

```js
window.__hexgame.renderProfile()
```

The summary reports sample count plus last, average, and max milliseconds for `terrain`, `objects`, `overlay`, `labels`, and `total`.

Use `window.__hexgame.resetRenderProfile()` between scenarios. If profiling was not enabled in the URL, run `window.__hexgame.setRenderProfiling(true)` first.

## Optimization Rule

Only design chunk caching after the profile shows terrain rendering dominates total render time in a realistic scene. Any caching plan must keep the `src/core/` and `src/render/` split intact.
