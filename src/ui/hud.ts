/**
 * Entire overlay UI as a single Vue app (render functions, no SFC): HUD, notice,
 * info panel (with interactive controls for own buildings), build toolbar with the
 * cart button, speedbar and a collapsible town list. Reads reactively from
 * store.display and triggers actions via operations.ts. Corresponds to
 * Hud/Controls/Panel/TownList from original/, bundled here into one component.
 */
import { createApp, h, ref, type VNode } from '@vue/runtime-dom'
import { BUILDING_TYPES } from '../core/buildings'
import { GOODS } from '../core/economy'
import {
  demolishSelection,
  focusBuilding,
  removeCart,
  setCartOutGood,
  setCartReturnGood,
  setMaxOutput,
  setMode,
  setSpeed,
  setTradingPostLimit,
  startRouteMode,
} from '../game/operations'
import type { Store } from '../game/store'

const SPEEDS = [0, 1, 2, 4] as const

function cssColor(n: number): string {
  return '#' + (n >>> 0).toString(16).padStart(6, '0')
}

export function installUi(store: Store, requestRender: () => void): void {
  const a = store.display
  const townsOpen = ref(false)

  const blur = (e: Event) => (e.currentTarget as HTMLElement).blur()

  const button = (id: string, label: string, color: number | null): VNode =>
    h(
      'button',
      {
        class: a.modeId === id ? 'active' : undefined,
        onClick: (e: MouseEvent) => {
          const type = BUILDING_TYPES.find((t) => t.id === id)
          setMode(store, type ? { kind: 'build', type } : { kind: 'select' })
          blur(e)
        },
      },
      [color !== null ? h('span', { class: 'dot', style: `background:${cssColor(color)}` }) : null, label],
    )

  // Compact non-negative integer field; commits on change (blur/Enter).
  const numberField = (value: number, onCommit: (v: number) => void): VNode =>
    h('input', {
      type: 'number',
      min: '0',
      value: String(value),
      class: 'limit-field',
      onChange: (e: Event) => onCommit(Number((e.target as HTMLInputElement).value) || 0),
    })

  // Good picker for cart freight; `empty` adds a "no freight" option (return leg).
  const goodSelect = (
    current: string,
    empty: boolean,
    prefix: string,
    title: string,
    onPick: (good: string) => void,
  ): VNode =>
    h(
      'select',
      { value: current, title, onChange: (e: Event) => onPick((e.target as HTMLSelectElement).value) },
      [
        empty ? h('option', { value: '' }, '← leer') : null,
        ...Object.entries(GOODS).map(([gid, gname]) => h('option', { value: gid }, `${prefix} ${gname}`)),
      ],
    )

  const panel = (): VNode | null => {
    const sel = a.selection
    if (!sel) return null
    return h('div', { class: 'panel' }, [
      h('h3', sel.title),
      ...sel.lines.map((line, i) => h('div', { class: i === 0 ? 'small' : undefined }, line)),
      // Producer: settable max output (reached → production stops, workers freed).
      sel.recipeOutput
        ? h('div', { class: 'limit-row' }, [
            h('span', `Max ${sel.recipeOutputLabel}`),
            numberField(sel.maxOutput, (v) => setMaxOutput(store, sel.id, v)),
          ])
        : null,
      // Trading post: per-good min (export reserve) / max (collection limit).
      sel.limits.length ? h('div', { class: 'small' }, 'Lager-Limits — Min / Max') : null,
      ...sel.limits.map((l) =>
        h('div', { class: 'limit-row' }, [
          h('span', l.label),
          numberField(l.min, (v) => setTradingPostLimit(store, sel.id, l.good, 'min', v)),
          numberField(l.max, (v) => setTradingPostLimit(store, sel.id, l.good, 'max', v)),
        ]),
      ),
      // Carts at this trading post; freight selectable at the home endpoint.
      ...sel.carts.map((c) =>
        h('div', { class: 'route-row' }, [
          h('span', `${c.label} · ${c.phase} `),
          c.controllable ? goodSelect(c.outGood, false, '→', 'Hin-Ware', (g) => setCartOutGood(store, c.id, g)) : null,
          c.controllable
            ? goodSelect(c.returnGood, true, '←', 'Rück-Ware (optional)', (g) => setCartReturnGood(store, c.id, g))
            : null,
          h('button', { title: 'Wagen auflösen', onClick: () => removeCart(store, c.id) }, '✕'),
        ]),
      ),
      // Demolish only for own buildings — replaces the former right-click demolish.
      sel.demolishable
        ? h(
            'button',
            {
              class: 'demolish',
              onClick: (e: MouseEvent) => {
                if (demolishSelection(store)) requestRender()
                blur(e)
              },
            },
            'Abreißen',
          )
        : null,
    ])
  }

  const townList = (): VNode => {
    const posts = [...store.buildings.byId.values()].filter((b) => b.typeId === 'tradingPost')
    return h('div', { class: 'townlist' }, [
      h(
        'button',
        { onClick: (e: MouseEvent) => ((townsOpen.value = !townsOpen.value), blur(e)) },
        `Orte ${townsOpen.value ? '▾' : '▸'}`,
      ),
      townsOpen.value
        ? h(
            'div',
            { class: 'townlist-items' },
            posts.map((b) =>
              h(
                'button',
                {
                  onClick: (e: MouseEvent) => {
                    focusBuilding(store, b.id)
                    requestRender()
                    blur(e)
                  },
                },
                `#${b.id} ${b.owner ?? 'Spieler'}`,
              ),
            ),
          )
        : null,
    ])
  }

  const App = {
    setup() {
      return () =>
        h('div', [
          // HUD — top left
          h('div', { class: 'hud' }, [
            h('div', { style: 'font-weight:600' }, 'HexGame — Vue-Version'),
            h(
              'div',
              { style: 'margin-top:4px' },
              `${a.money} 💰 · Tick ${a.tick} · ${a.speed === 0 ? 'Pause' : a.speed + '×'}`,
            ),
            h('div', { class: 'small' }, `${a.towns} Orte · ${a.buildings} Gebäude`),
            h('div', { class: 'small' }, `Hex (${a.q}, ${a.r}) · ${a.terrain}${a.place ? ' · ' + a.place : ''}`),
          ]),
          // Town list — below the HUD
          townList(),
          // Notice — top center
          a.notice ? h('div', { class: 'notice' }, a.notice) : null,
          // Info panel — top right
          panel(),
          // Build toolbar — bottom
          h('div', { class: 'toolbar' }, [
            button('select', 'Zeiger', null),
            ...BUILDING_TYPES.map((t) => button(t.id, t.name, t.color)),
            h(
              'button',
              {
                class: a.modeId === 'route' ? 'active' : undefined,
                onClick: (e: MouseEvent) => (startRouteMode(store), blur(e)),
              },
              [h('span', { class: 'dot', style: 'background:#ffd166' }), 'Wagen'],
            ),
          ]),
          // Speedbar — bottom right
          h(
            'div',
            { class: 'speedbar' },
            SPEEDS.map((s) =>
              h(
                'button',
                {
                  class: a.speed === s ? 'active' : undefined,
                  title: s === 0 ? 'Pause (Leertaste)' : `Tempo ${s}×`,
                  onClick: (e: MouseEvent) => {
                    setSpeed(store, s)
                    blur(e)
                  },
                },
                s === 0 ? '⏸' : `${s}×`,
              ),
            ),
          ),
        ])
    },
  }

  createApp(App).mount('#ui')
}
