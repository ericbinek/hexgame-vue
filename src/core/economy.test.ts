import { describe, expect, it } from 'vitest';
import { Buildings } from './buildings';
import {
  buildingHex,
  ECON,
  Economy,
  tradingPostCapacity,
  tradingPostVolumeUsed,
  payBuildCost,
  RECIPES,
  stockOf,
  volumeOf,
  workersNeeded,
  workersOf,
} from './economy';
import { hexDistance } from './hex';
import { World } from './world';

/**
 * Setup via restore(): places without terrain rules — the Economy is meant to
 * be tested in isolation here, not the placement rules.
 */
function setup(entries: Array<{ t: string; cells: number[][]; inv?: Record<string, number>; wt?: number }>) {
  const world = new World();
  const buildings = new Buildings(world);
  buildings.restore(JSON.stringify({ v: 1, buildings: entries.map((e) => ({ ...e, z: 0 })) }));
  const list = [...buildings.byId.values()].sort((a, b) => a.id - b.id);
  return { buildings, economy: new Economy(buildings), list };
}

describe('hexDistance', () => {
  it('misst Axialdistanz korrekt', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: -1 })).toBe(1);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
    expect(hexDistance({ q: -2, r: 3 }, { q: 1, r: 1 })).toBe(3);
  });
});

describe('Produktion', () => {
  it('Werkstatt produziert nur mit Arbeitern', () => {
    const alone = setup([{ t: 'sawmill', cells: [[4, 0]] }]);
    alone.economy.tick();
    expect(stockOf(alone.list[0], 'wood')).toBe(0);

    const staffed = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'sawmill', cells: [[4, 0]] },
    ]);
    const report = staffed.economy.tick();
    // House(0,0) → sawmill(1,1): commute distance 2 → productionNear(4) − 2 = 2 units/tick.
    const amount = staffed.economy.productionAmountOf(staffed.list[1]);
    expect(amount).toBe(2);
    expect(stockOf(staffed.list[1], 'wood')).toBe(amount);
    expect(report.produced).toBe(amount);
    expect(report.workersUsed).toBe(RECIPES.sawmill.workers);
  });

  it('Arbeiter lokal: nur Betriebe in Reichweite werden versorgt, ferne bleiben leer', () => {
    // 2 fresh houses = 4 workers. Two sawmills stand close (in range),
    // one far out (outside workerRadius) — the far one gets nothing,
    // even if computationally there were still free workers.
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'house', cells: [[2, 0]] },
      { t: 'sawmill', cells: [[4, 0]] }, // Hex(1,1), close
      { t: 'sawmill', cells: [[6, 0]] }, // Hex(1,1), close
      { t: 'sawmill', cells: [[100, 0]] }, // far out, out of range
    ]);
    const report = economy.tick();
    expect(economy.isActive(list[2])).toBe(true);
    expect(economy.isActive(list[3])).toBe(true);
    expect(economy.isActive(list[4])).toBe(false); // out of range
    expect(report.workersUsed).toBe(2 * RECIPES.sawmill.workers); // only the two close ones
  });

  it('knappe Arbeiter: bei gleicher Nähe gewinnt ein Betrieb, der andere bleibt leer', () => {
    // 1 house = 2 workers; two equally close sawmills compete — only one
    // gets fully staffed, the other goes empty (no half assignments).
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'sawmill', cells: [[4, 0]] },
      { t: 'sawmill', cells: [[6, 0]] },
    ]);
    economy.tick();
    const active = [list[1], list[2]].filter((b) => economy.isActive(b));
    expect(active.length).toBe(1);
  });

  it('Wegzeit-Stufen: die Pendeldistanz drückt die Stückzahl (4→3→2→1)', () => {
    // House and sawmill at a defined hex distance; units/tick = productionNear − distance.
    const cases = [
      { house: 6, work: 4, dist: 0, amount: 4 }, // same hex cell (on/next to the operation)
      { house: 2, work: 4, dist: 1, amount: 3 },
      { house: 0, work: 4, dist: 2, amount: 2 },
      { house: 0, work: 8, dist: 3, amount: 1 },
    ];
    for (const f of cases) {
      const { economy, list } = setup([
        { t: 'house', cells: [[f.house, 0]] },
        { t: 'sawmill', cells: [[f.work, 0]] },
      ]);
      const report = economy.tick();
      expect(economy.commuteOf(list[1]), `Distanz haus=${f.house} werk=${f.work}`).toBe(f.dist);
      expect(economy.productionAmountOf(list[1]), `Menge bei Distanz ${f.dist}`).toBe(f.amount);
      expect(report.produced).toBe(f.amount);
    }
  });

  it('zugeteilte Arbeiter: aktiver Betrieb hat alle, inaktiver keine', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'sawmill', cells: [[4, 0]] },
      { t: 'sawmill', cells: [[8, 0]] },
    ]);
    economy.tick(); // 1 house = 2 workers → enough for exactly one sawmill
    expect(workersNeeded(list[1])).toBe(RECIPES.sawmill.workers);
    expect(economy.assignedWorkers(list[1])).toBe(RECIPES.sawmill.workers);
    expect(economy.assignedWorkers(list[2])).toBe(0);
    // House provides, but needs none itself → requires 0
    expect(workersNeeded(list[0])).toBe(0);
    expect(economy.assignedWorkers(list[0])).toBe(0);
  });

  it('manuelles Arbeiter-Ziel priorisiert den gewählten Betrieb', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'house', cells: [[2, 0]] },
      { t: 'farm', cells: [[4, 0]] },
      { t: 'mine', cells: [[6, 0]] },
      { t: 'sawmill', cells: [[8, 0]] },
    ]);

    economy.tick();
    expect(economy.isActive(list[2])).toBe(true); // food-chain priority
    expect(economy.isActive(list[3])).toBe(true); // next closest industry
    expect(economy.assignedWorkers(list[4])).toBe(0);

    list[4].workerTarget = RECIPES.sawmill.workers;
    economy.tick();
    expect(economy.assignedWorkers(list[4])).toBe(RECIPES.sawmill.workers);
    expect(economy.isActive(list[4])).toBe(true);
    expect(economy.isActive(list[3])).toBe(false);
  });

  it('manuelles Teilziel reserviert Arbeiter, ohne Produktion freizuschalten', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'sawmill', cells: [[4, 0]], wt: 1 },
    ]);

    const report = economy.tick();
    expect(economy.assignedWorkers(list[1])).toBe(1);
    expect(economy.isActive(list[1])).toBe(false);
    expect(report.workersUsed).toBe(1);
    expect(stockOf(list[1], 'wood')).toBe(0);
    expect(economy.statusText(list[1])).toBe('wartet auf weitere Arbeiter (1/2)');
  });

  it('meldet freie lokale Arbeiter für den gewählten Betrieb', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'sawmill', cells: [[4, 0]], inv: { wood: RECIPES.sawmill.buffer } },
    ]);

    economy.tick();
    expect(economy.assignedWorkers(list[1])).toBe(0);
    expect(economy.assignableWorkersOf(list[1])).toBe(2);
  });

  it('voller Puffer stoppt die Produktion', () => {
    const buffer = RECIPES.sawmill.buffer;
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'sawmill', cells: [[4, 0]], inv: { wood: buffer } },
    ]);
    const report = economy.tick();
    expect(report.produced).toBe(0);
    expect(stockOf(list[1], 'wood')).toBe(buffer);
  });
});

describe('Säulen-Bindung der Arbeiter', () => {
  // House directly above/on an operation (same (x,y) column, e.g. z=1 above z=0)
  // → its workers are reserved for this operation. Setup via restore with
  //   explicit z (the setup() above forces z=0).
  function stacked(entries: Array<{ t: string; z: number; cells: number[][]; inv?: Record<string, number> }>) {
    const world = new World();
    const buildings = new Buildings(world);
    buildings.restore(JSON.stringify({ v: 1, buildings: entries }));
    const find = (typeId: string) => [...buildings.byId.values()].find((b) => b.typeId === typeId)!;
    return { economy: new Economy(buildings), find };
  }

  it('reserviert das aufgesetzte Haus — auch gegen die Nahrungskette-Priorität', () => {
    // Farm (food chain) and sawmill (industry) in the same hex cell (0,0), above
    // each a house (same column). Scarce workers: the farm house is in the emergency
    // (1 worker, empty inv), the sawmill house is supplied (2). WITHOUT binding the
    // preferred farm would tap the sawmill house and run, the sawmill would starve. WITH
    // binding the sawmill keeps its house → it runs, the undersupplied farm stands.
    const { economy, find } = stacked([
      { t: 'farm', z: 0, cells: [[0, 0]] },
      { t: 'house', z: 1, cells: [[0, 0]], inv: {} }, // above the farm → emergency (1)
      { t: 'sawmill', z: 0, cells: [[-2, 0]] }, // same hex cell (0,0)
      { t: 'house', z: 1, cells: [[-2, 0]], inv: { bread: 5 } }, // above the sawmill → 2
    ]);
    economy.tick();
    expect(economy.isActive(find('sawmill')), 'Sägewerk läuft aus seinem Säulen-Haus').toBe(true);
    expect(economy.isActive(find('farm')), 'Hof steht — eigenes Haus im Notfall, fremdes tabu').toBe(false);
  });

  it('beide Betriebe laufen aus dem jeweils eigenen Säulen-Haus (Wegzeit 0)', () => {
    const { economy, find } = stacked([
      { t: 'farm', z: 0, cells: [[0, 0]], inv: {} },
      { t: 'house', z: 1, cells: [[0, 0]], inv: { bread: 5 } }, // 2 workers
      { t: 'sawmill', z: 0, cells: [[-2, 0]] },
      { t: 'house', z: 1, cells: [[-2, 0]], inv: { bread: 5 } }, // 2 workers
    ]);
    economy.tick();
    expect(economy.isActive(find('farm'))).toBe(true);
    expect(economy.isActive(find('sawmill'))).toBe(true);
    expect(economy.commuteOf(find('farm'))).toBe(0); // own house, travel time 0
    expect(economy.commuteOf(find('sawmill'))).toBe(0);
  });
});

describe('Kontor-Logistik', () => {
  it('sammelt im Umkreis ein, begrenzt pro Tick', () => {
    const { economy, list } = setup([
      { t: 'sawmill', cells: [[4, 0]], inv: { wood: 8 } },
      { t: 'tradingPost', cells: [[6, 0]] },
    ]);
    expect(hexDistance(buildingHex(list[0]), buildingHex(list[1]))).toBeLessThanOrEqual(ECON.tradingPostRadius);
    const report = economy.tick();
    expect(report.collected).toBe(ECON.collectPerTick);
    expect(stockOf(list[1], 'wood')).toBe(ECON.collectPerTick);
    expect(stockOf(list[0], 'wood')).toBe(8 - ECON.collectPerTick);
  });

  it('außerhalb des Radius wird nichts abgeholt', () => {
    const { economy, list } = setup([
      { t: 'sawmill', cells: [[100, 0]], inv: { wood: 8 } },
      { t: 'tradingPost', cells: [[0, 0]] },
    ]);
    expect(hexDistance(buildingHex(list[0]), buildingHex(list[1]))).toBeGreaterThan(ECON.tradingPostRadius);
    const report = economy.tick();
    expect(report.collected).toBe(0);
    expect(stockOf(list[0], 'wood')).toBe(8);
  });

  it('Kette über mehrere Ticks: produzieren, einsammeln, Gesamtbestand wächst', () => {
    const { economy } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'sawmill', cells: [[4, 0]] },
      { t: 'tradingPost', cells: [[8, 0]] },
    ]);
    let last = economy.tick();
    for (let i = 0; i < 5; i++) last = economy.tick();
    expect(last.tick).toBe(6);
    // House(0,0) → sawmill(1,1): distance 2 → 2 wood/tick, all goes to the trading post.
    expect(last.stored.wood).toBe(12);
  });

  it('Brauerei zieht Korn aus dem Kontor und braut Bier', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'brewery', cells: [[4, 0]] },
      { t: 'tradingPost', cells: [[8, 0]], inv: { grain: 10 } },
    ]);
    const report = economy.tick();
    // House(0,0) → brewery(1,1): distance 2 → 2 beer/tick; for that 4 grain drawn and
    // consumed, 2 beer brewed, the trading post collects it again.
    expect(report.produced).toBe(2);
    expect(stockOf(list[2], 'grain')).toBe(10 - 4);
    expect(stockOf(list[2], 'beer')).toBe(2);
    expect(stockOf(list[1], 'grain')).toBe(0);
  });

  it('ohne Korn wartet die Brauerei', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'brewery', cells: [[4, 0]] },
      { t: 'tradingPost', cells: [[8, 0]] },
    ]);
    const report = economy.tick();
    expect(report.produced).toBe(0);
    expect(economy.statusText(list[1])).toContain('wartet auf Korn');
  });

  it('volle Kette Hof → Kontor → Brauerei: Bier entsteht und wird verteilt', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'house', cells: [[2, 0]] },
      { t: 'farm', cells: [[4, 0]] },
      { t: 'brewery', cells: [[6, 0]] }, // close enough to the houses (workerRadius)
      { t: 'tradingPost', cells: [[8, 0]], inv: { grain: 20 } },
    ]);
    for (let i = 0; i < 8; i++) economy.tick();
    // Beer ends up in the trading post OR in the house stocks (houses fetch it).
    const houses = list.filter((b) => b.typeId === 'house');
    const beerInSystem = economy.totalStored('beer') + houses.reduce((s, h) => s + stockOf(h, 'beer'), 0);
    expect(beerInSystem).toBeGreaterThanOrEqual(3);
  });

  it('Inventar überlebt die Serialisierung', () => {
    const { buildings, economy } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'sawmill', cells: [[4, 0]] },
      { t: 'tradingPost', cells: [[8, 0]] },
    ]);
    economy.tick();
    economy.tick();

    const world2 = new World();
    const b2 = new Buildings(world2);
    b2.restore(buildings.serialize());
    const e2 = new Economy(b2);
    expect(e2.totalStored('wood')).toBe(economy.totalStored('wood'));
  });
});

describe('Konsum', () => {
  // House with id 1 is due when (tick + 1) % 8 === 0 → tick 7, 15, 23 …
  // Workers = 1 (emergency) + bread(+1) + beer(+1); needs hysteresis 0..2 per good.

  it('frisches Wohnhaus ist brot-versorgt und stellt 2 Arbeiter (Bier kommt erst per Lieferung)', () => {
    const { list } = setup([{ t: 'house', cells: [[0, 0]] }]);
    expect(workersOf(list[0])).toBe(2);
  });

  it('mit Brot und Bier steigt das Haus auf 3 Arbeiter; der Verbrauch zehrt am Vorrat', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[4, 0]], inv: { bread: 40, beer: 40 } },
    ]);
    for (let i = 0; i < 24; i++) economy.tick(); // several consumption cycles
    expect(workersOf(list[0])).toBe(3); // bread + beer covered
    expect(stockOf(list[1], 'bread')).toBeLessThan(40);
    expect(stockOf(list[1], 'beer')).toBeLessThan(40);
  });

  it('ohne Brot und Bier fällt das Haus auf den Notfall (1 Arbeiter)', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[4, 0]] }, // empty
    ]);
    for (let i = 0; i < 16; i++) economy.tick(); // due dates 7, 15
    expect(workersOf(list[0])).toBe(1);
    expect(stockOf(list[0], 'bread')).toBe(0);
    expect(stockOf(list[0], 'beer')).toBe(0);
  });

  it('nur Brot (kein Bier) ergibt 2 Arbeiter', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[4, 0]], inv: { bread: 30 } },
    ]);
    for (let i = 0; i < 16; i++) economy.tick();
    expect(workersOf(list[0])).toBe(2); // bread stock yes, beer no
    expect(stockOf(list[0], 'bread')).toBeGreaterThan(0);
    expect(stockOf(list[0], 'beer')).toBe(0);
  });

  it('ein Kontor außerhalb des Radius versorgt nicht', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[100, 0]], inv: { bread: 20, beer: 20 } },
    ]);
    for (let i = 0; i < 16; i++) economy.tick();
    expect(workersOf(list[0])).toBe(1);
    expect(stockOf(list[1], 'bread')).toBe(20); // untouched
    expect(stockOf(list[1], 'beer')).toBe(20);
  });

  it('needs überleben die Serialisierung', () => {
    const { buildings, economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[4, 0]], inv: { bread: 30 } }, // only bread
    ]);
    for (let i = 0; i < 16; i++) economy.tick();
    expect(workersOf(list[0])).toBe(2);

    const world2 = new World();
    const b2 = new Buildings(world2);
    b2.restore(buildings.serialize());
    const restored = [...b2.byId.values()].find((b) => b.typeId === 'house')!;
    expect(workersOf(restored)).toBe(2);
  });
});

describe('Volumen-Lager', () => {
  it('Kontor-Kapazität wird in m³ gemessen, nicht in Stück', () => {
    const { list } = setup([{ t: 'tradingPost', cells: [[0, 0]], inv: { ore: 5, bread: 4 } }]);
    // 5 ore × 4 m³ + 4 bread × 1 m³ = 24 m³
    expect(tradingPostVolumeUsed(list[0])).toBe(5 * volumeOf('ore') + 4 * volumeOf('bread'));
    expect(volumeOf('ore')).toBeGreaterThan(volumeOf('bread'));
  });

  it('sperrige Ware füllt das Lager schneller (Volumen begrenzt das Einsammeln)', () => {
    // Mine produces ore (4 m³). Trading post nearly full → only a little still fits in.
    const { buildings, economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'mine', cells: [[2, 0]] },
      { t: 'tradingPost', cells: [[4, 0]], inv: { ore: 29 } }, // 116 m³ of 120 → room for exactly 1 more
    ]);
    const tradingPost = list[2];
    tradingPost.limits = { ore: { min: 0, max: 100 } }; // high unit max → the volume is the limit
    const cap = tradingPostCapacity(buildings, tradingPost);
    for (let i = 0; i < 6; i++) economy.tick();
    expect(tradingPostVolumeUsed(tradingPost)).toBeLessThanOrEqual(cap);
    expect(tradingPostVolumeUsed(tradingPost)).toBeGreaterThan(116); // collected a bit more
  });

  it('Schuppen in der Kontor-Säule erhöhen die Kapazität', () => {
    const world = new World();
    const buildings = new Buildings(world);
    buildings.restore(
      JSON.stringify({
        v: 1,
        buildings: [
          { t: 'tradingPost', z: 0, cells: [[0, 0]] },
          { t: 'shed', z: 1, cells: [[0, 0]] }, // directly above
          { t: 'shed', z: -1, cells: [[0, 0]] }, // and below
        ],
      }),
    );
    const tradingPost = [...buildings.byId.values()].find((b) => b.typeId === 'tradingPost')!;
    expect(tradingPostCapacity(buildings, tradingPost)).toBe(ECON.tradingPostBaseVolume + 2 * ECON.shedVolume);
  });
});

describe('Mehl-Kette', () => {
  it('Mühle mahlt Korn zu Mehl (2 Korn je Mehl)', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'mill', cells: [[4, 0]] },
      { t: 'tradingPost', cells: [[8, 0]], inv: { grain: 10 } },
    ]);
    const report = economy.tick();
    // House(0,0) → mill(1,1): distance 2 → 2 flour/tick, for that 4 grain (2 per flour).
    expect(report.produced).toBe(2);
    expect(stockOf(list[2], 'grain')).toBe(10 - 4);
    expect(stockOf(list[2], 'flour')).toBe(2);
  });

  it('Bäckerei zieht Mehl aus dem Kontor und backt Brot', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'bakery', cells: [[4, 0]] },
      { t: 'tradingPost', cells: [[8, 0]], inv: { flour: 10 } },
    ]);
    const report = economy.tick();
    // House(0,0) → bakery(1,1): distance 2 → 2 bread/tick, for that 2 flour (1 per bread).
    expect(report.produced).toBe(2);
    expect(stockOf(list[2], 'flour')).toBe(10 - 2);
    expect(stockOf(list[2], 'bread')).toBe(2);
  });

  it('Bäckerei holt Mehl direkt von der Mühle, wenn das Kontor keins hat', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'house', cells: [[2, 0]] },
      { t: 'mill', cells: [[4, 0]], inv: { flour: 8 } }, // flour in the mill buffer
      { t: 'bakery', cells: [[6, 0]] },
      { t: 'tradingPost', cells: [[8, 0]] }, // trading post empty
    ]);
    const report = economy.tick();
    expect(stockOf(list[2], 'flour')).toBeLessThan(8); // drawn directly from the mill
    expect(report.produced).toBeGreaterThan(0); // bakery could bake
  });

  it('Brot wird trotz Holz-Vorrat im Kontor eingesammelt (Lager nicht verstopft)', () => {
    // A large wood stock (90 m³) must not block collecting the food —
    // otherwise the bread gets stuck in the bakery and the houses starve.
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'house', cells: [[2, 0]] },
      { t: 'bakery', cells: [[6, 0]] },
      { t: 'tradingPost', cells: [[8, 0]], inv: { wood: 30, flour: 20 } }, // 90 m³ wood + flour supply
    ]);
    for (let i = 0; i < 12; i++) economy.tick();
    // Bread reaches the trading post or the house stocks (warehouse not clogged by wood).
    const houses = list.filter((b) => b.typeId === 'house');
    const breadInSystem = economy.totalStored('bread') + houses.reduce((s, h) => s + stockOf(h, 'bread'), 0);
    expect(breadInSystem).toBeGreaterThan(0);
  });
});

describe('Direkt-Bezug', () => {
  it('Brauerei holt Korn direkt vom Hof, wenn das Kontor keins hat', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'house', cells: [[2, 0]] },
      { t: 'farm', cells: [[4, 0]], inv: { grain: 8 } }, // grain in the farm buffer
      { t: 'brewery', cells: [[6, 0]] },
      { t: 'tradingPost', cells: [[8, 0]] }, // trading post empty
    ]);
    const report = economy.tick();
    expect(stockOf(list[2], 'grain')).toBeLessThan(8); // drawn directly from the farm
    expect(report.produced).toBeGreaterThan(0); // brewery could brew
  });
});

describe('Min/Max-Steuerung', () => {
  it('ein satter Betrieb (Max erreicht) gibt seine Arbeiter frei', () => {
    // 1 fresh house = 2 workers; farm + bakery would each need 2. The farm has
    // its output buffer already full (max reached) → it gets no workers,
    // so that the scarce 2 workers go to the bakery.
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'farm', cells: [[2, 0]], inv: { grain: RECIPES.farm.buffer } }, // max reached
      { t: 'bakery', cells: [[4, 0]] },
      { t: 'tradingPost', cells: [[6, 0]], inv: { flour: 10 } }, // flour supply for the bakery
    ]);
    economy.tick();
    expect(economy.isActive(list[1])).toBe(false); // farm: satisfied → no workers
    expect(economy.isActive(list[2])).toBe(true); // bakery: gets the workers
    // House(0,0) → bakery(1,1): distance 2 → 2 bread/tick.
    expect(stockOf(list[2], 'bread')).toBe(2);
  });

  it('Kontor sammelt eine Ware nur bis zum eingestellten Max', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0]] },
      { t: 'farm', cells: [[2, 0]] },
      { t: 'tradingPost', cells: [[4, 0]], inv: { grain: 5 } },
    ]);
    list[2].limits = { grain: { min: 0, max: 6 } };
    for (let i = 0; i < 10; i++) economy.tick();
    expect(stockOf(list[2], 'grain')).toBe(6); // collection stops at max
  });

  it('maxOutput und limits überleben die Serialisierung', () => {
    const { buildings, list } = setup([
      { t: 'farm', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[4, 0]] },
    ]);
    list[0].maxOutput = 3;
    list[1].limits = { grain: { min: 5, max: 20 } };

    const world2 = new World();
    const b2 = new Buildings(world2);
    b2.restore(buildings.serialize());
    const restored = [...b2.byId.values()].sort((a, b) => a.id - b.id);
    expect(restored[0].maxOutput).toBe(3);
    expect(restored[1].limits).toEqual({ grain: { min: 5, max: 20 } });
  });
});

describe('Wartung', () => {
  // Sawmill with id 2 is due when (tick + 2) % 16 === 0 → tick 14, 30 …

  it('Betrieb zieht am Fälligkeits-Tick 1 Holz aus dem Kontor und läuft weiter', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      // Sawmill 3 hex fields from the house (commute distance 3 → 1 wood/tick), so that
      // the balance works out as before and the warehouse is not clogged by overproduction.
      { t: 'sawmill', cells: [[8, 0]] },
      // Bread/beer stock keeps the house supplied (otherwise it falls to 1 worker
      // and the sawmill stands); high wood max → no collection cap.
      { t: 'tradingPost', cells: [[6, 0]], inv: { wood: 5, bread: 40, beer: 40 } },
    ]);
    list[2].limits = { wood: { min: 0, max: 100 } };
    for (let i = 0; i < 14; i++) economy.tick();
    expect(list[1].needsMaintenance).toBeFalsy();
    expect(economy.isActive(list[1])).toBe(true);
    // Stock: 5 start − 1 maintenance + 14 produced/collected (1 wood/tick)
    expect(stockOf(list[2], 'wood')).toBe(5 - 1 + 14);
  });

  it('ohne Holz steht der Betrieb still und erholt sich mit Nachschub', () => {
    // Bread/beer buffer keeps the houses supplied (otherwise emergency → too few
    // workers); the test checks the maintenance, not the consumption.
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'brewery', cells: [[4, 0]] }, // produces no wood
      { t: 'tradingPost', cells: [[8, 0]], inv: { bread: 40, beer: 40 } },
    ]);
    for (let i = 0; i < 14; i++) economy.tick(); // due at tick 14
    expect(list[1].needsMaintenance).toBe(true);
    expect(economy.isActive(list[1])).toBe(false);
    expect(economy.statusText(list[1])).toContain('Wartung fällig');

    list[2].inv!.wood = 2;
    economy.tick();
    expect(list[1].needsMaintenance).toBeFalsy();
    expect(economy.isActive(list[1])).toBe(true);
    expect(stockOf(list[2], 'wood')).toBe(1);
  });
});

describe('Baukosten', () => {
  it('bucht Holz aus Kontoren im Umkreis ab, dryRun prüft nur', () => {
    const { buildings, list } = setup([
      { t: 'tradingPost', cells: [[0, 0]], inv: { wood: 5 } },
    ]);
    const site = { x: 4, y: 0 };
    const dry = payBuildCost(buildings, 'house', site, { dryRun: true });
    expect(dry.ok).toBe(true);
    expect(stockOf(list[0], 'wood')).toBe(5);

    const paid = payBuildCost(buildings, 'house', site);
    expect(paid).toEqual({ ok: true, cost: 3 });
    expect(stockOf(list[0], 'wood')).toBe(2);

    const broke = payBuildCost(buildings, 'house', site);
    expect(broke.ok).toBe(false);
  });

  it('Kontore außerhalb des Umkreises zählen nicht, Kontor selbst ist frei', () => {
    const { buildings } = setup([
      { t: 'tradingPost', cells: [[100, 0]], inv: { wood: 50 } },
    ]);
    expect(payBuildCost(buildings, 'house', { x: 0, y: 0 }).ok).toBe(false);
    expect(payBuildCost(buildings, 'tradingPost', { x: 0, y: 0 }).ok).toBe(true);
  });
});

describe('Werkzeug-Kette', () => {
  it('Schmiede zieht Erz und Holz und schmiedet Werkzeug', () => {
    const { economy, list } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'smithy', cells: [[4, 0]] },
      { t: 'tradingPost', cells: [[8, 0]], inv: { ore: 4, wood: 4 } },
    ]);
    economy.tick();
    // House(0,0) → smithy(1,1): distance 2 → 2 tools/tick (each 1 ore + 1 wood).
    expect(stockOf(list[2], 'tools')).toBe(2);
  });
});
