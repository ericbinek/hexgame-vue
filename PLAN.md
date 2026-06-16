# Design notes — HexGame Vue Edition

**Stack:** Vue 3 (runtime-only) + Canvas 2D · **Language:** TypeScript · **Status: complete** ✅

## Idea

A render-free TypeScript simulation core with a Vue + Canvas presentation layer on top.
The package surface is kept deliberately small because supply-chain attacks on npm are a
real, active threat — that constraint shapes every tooling choice.

## Stack decisions (supply-chain-minimized)

Three runtime/dev npm packages total, installed via **pnpm** with hardening
(`minimumReleaseAge: 10080` = 7 days, blocked install scripts, exact pinned versions,
checked-in `pnpm-lock.yaml`).

- **Build/dev:** `esbuild` (transpile + bundle + dev server) instead of Vite — 0 regular deps.
- **Tests:** `node:test` + a tiny self-written `vitest` shim (`test/vitest-shim.ts`, wired via an
  esbuild alias `vitest` → shim). The unit tests run 1:1 against it — 0 test packages.
- **Framework:** `@vue/runtime-dom` (runtime-only) instead of full `vue` — **render functions
  (`h()`)** instead of SFC templates, which drops the compiler + ~7 transitive packages
  (Babel, PostCSS, …).
- **Map rendering:** **Canvas 2D** instead of Pixi.js — browser API, 0 packages.
- **State:** a reactive store via `@vue/reactivity`; a `requestAnimationFrame` tick loop drives
  `economy.tick()` / `routes.tick()` every `TICK_MS`. Only a small `display` projection is
  reactive; the simulation objects stay plain.
- **Persistence:** `localStorage`.

## Architecture

Hard `core ↔ render` split (see `README.md`). `src/core/` is pure, unit-tested logic; the
renderer, store and UI sit on top and never leak into the core. The triangle grid (`tri.ts` +
`hex.ts`) is the one source of truth for coordinates.

## Deliberate simplification

The Canvas renderer draws in **immediate mode** rather than caching map chunks (as the Pixi
reference does). For the current map sizes this stays smooth. Chunk caching
(`OffscreenCanvas` per chunk or a `Path2D` cache) is a possible later optimization.

## Possible next steps

- Chunk caching for very large maps.
- Market prices that depend on NPC stock levels (instead of fixed `PRICES`).
- More goods/recipes (fish, salt, wool, cloth) and consumption tiers.
