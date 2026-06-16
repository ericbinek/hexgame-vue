import { describe, expect, it } from 'vitest';
import { Buildings } from './buildings';
import { Economy, stockOf, workersOf } from './economy';
import { triToHex } from './hex';
import { generateSettlements, growSettlements, settlementTradingPosts, GROWTH } from './npc';
import { PRICES, ROUTE, Routes, type Treasury } from './routes';
import { isMountain } from './terrain';
import { World } from './world';

function freshWorld() {
  const world = new World();
  const buildings = new Buildings(world);
  return { world, buildings };
}

describe('Siedlungs-Generierung', () => {
  it('gründet die Siedlungen mit Kontor, Wohnhäusern und Spezialisierung', () => {
    const { buildings } = freshWorld();
    const founded = generateSettlements(buildings);
    expect(founded.length).toBeGreaterThanOrEqual(2);
    const tradingPosts = settlementTradingPosts(buildings);
    expect(tradingPosts.map((k) => k.name).sort()).toEqual([...founded].sort());
    for (const { name, tradingPostId } of tradingPosts) {
      const members = [...buildings.byId.values()].filter((b) => b.owner === name);
      expect(members.length).toBeGreaterThanOrEqual(3); // Kontor + 2 Wohnhäuser mindestens
      const tradingPost = buildings.byId.get(tradingPostId)!;
      expect(Object.values(tradingPost.inv ?? {}).some((n) => n > 0)).toBe(true); // Startwaren
    }
  });

  it('Erz-Dorf siedelt am Gebirge und betreibt Mine + Schmiede', () => {
    const { buildings } = freshWorld();
    generateSettlements(buildings);
    const erzgrund = [...buildings.byId.values()].filter((b) => b.owner === 'Erzgrund');
    expect(erzgrund.length, 'Erz-Dorf wurde gegründet').toBeGreaterThanOrEqual(3);
    const mine = erzgrund.find((b) => b.typeId === 'mine');
    expect(mine, 'Erz-Dorf hat eine Mine').toBeDefined();
    const h = triToHex(mine!.cells[0].x, mine!.cells[0].y);
    expect(isMountain(h.q, h.r), 'Mine liegt auf Gebirge').toBe(true);
    expect(erzgrund.some((b) => b.typeId === 'smithy'), 'Erz-Dorf hat eine Schmiede').toBe(true);
  });

  it('ergänzt fehlende Siedlungen in einem bestehenden Spielstand', () => {
    const { buildings } = freshWorld();
    // Alter Stand mit nur einem NPC-Dorf (wie vor dem Hinzufügen weiterer SPECS).
    buildings.restore(JSON.stringify({ v: 1, buildings: [{ t: 'tradingPost', z: 0, cells: [[0, 0]], o: 'Eldwik' }] }));
    const founded = generateSettlements(buildings);
    expect(founded).not.toContain('Eldwik'); // existiert schon → nicht doppelt
    expect(founded).toContain('Erzgrund'); // neu hinzugekommen → wird ergänzt
  });

  it('rüstet bestehenden Siedlungen eine fehlende Mühle nach (alte Spielstände)', () => {
    const { buildings } = freshWorld();
    // Alter Stand: Eldwik mit Bäckerei, aber ohne Mühle (vor der dreistufigen Kette).
    buildings.restore(
      JSON.stringify({
        v: 1,
        buildings: [
          { t: 'tradingPost', z: 0, cells: [[0, 0]], o: 'Eldwik' },
          { t: 'house', z: 0, cells: [[2, 0]], o: 'Eldwik' },
          { t: 'bakery', z: 0, cells: [[4, 0]], o: 'Eldwik' },
        ],
      }),
    );
    const changed = generateSettlements(buildings);
    expect(changed).toContain('Eldwik'); // Mühle nachgerüstet → als geändert gemeldet
    const eldwik = [...buildings.byId.values()].filter((b) => b.owner === 'Eldwik');
    expect(eldwik.some((b) => b.typeId === 'mill'), 'Mühle vorhanden').toBe(true);
    // Idempotent: ein zweiter Lauf rüstet nichts mehr nach.
    expect(generateSettlements(buildings)).not.toContain('Eldwik');
  });

  it('ist deterministisch und läuft nur einmal', () => {
    const a = freshWorld();
    const b = freshWorld();
    generateSettlements(a.buildings);
    generateSettlements(b.buildings);
    expect(a.buildings.serialize()).toBe(b.buildings.serialize());
    expect(generateSettlements(a.buildings)).toEqual([]); // zweiter Aufruf: nichts
  });
});

describe('Siedlungs-Wachstum', () => {
  /** NPC-Siedlung „Wacker" mit Kontor (Brot-Vorrat) und einer Anzahl Wohnhäuser. */
  function town(tradingPostInv: Record<string, number>, houses: number) {
    const { buildings } = freshWorld();
    const entries: Array<{ t: string; z: number; cells: number[][]; o: string; inv?: Record<string, number> }> = [
      { t: 'tradingPost', z: 0, cells: [[0, 0]], o: 'Wacker', inv: tradingPostInv },
    ];
    for (let i = 0; i < houses; i++) entries.push({ t: 'house', z: 0, cells: [[2 + 2 * i, 0]], o: 'Wacker' });
    buildings.restore(JSON.stringify({ v: 1, buildings: entries }));
    return buildings;
  }
  const houseCount = (b: Buildings) => [...b.byId.values()].filter((x) => x.typeId === 'house').length;

  it('wächst bei Brot-Überschuss um ein Wohnhaus', () => {
    const buildings = town({ bread: GROWTH.breadSurplus }, 3);
    const grown = growSettlements(buildings);
    expect(grown).toContain('Wacker');
    expect(houseCount(buildings)).toBe(4);
  });

  it('wächst nicht ohne echten Brot-Überschuss', () => {
    const buildings = town({ bread: GROWTH.breadSurplus - 1 }, 3);
    expect(growSettlements(buildings)).toEqual([]);
    expect(houseCount(buildings)).toBe(3);
  });

  it('wächst nicht über die Häuser-Obergrenze hinaus', () => {
    const buildings = town({ bread: 100 }, GROWTH.maxHouses);
    expect(growSettlements(buildings)).toEqual([]);
    expect(houseCount(buildings)).toBe(GROWTH.maxHouses);
  });

  it('lässt Spieler-Bauten (ohne Besitzer) unberührt', () => {
    const { buildings } = freshWorld();
    buildings.restore(
      JSON.stringify({
        v: 1,
        buildings: [
          { t: 'tradingPost', z: 0, cells: [[0, 0]], inv: { bread: 100 } }, // Spieler (owner undefined)
          { t: 'house', z: 0, cells: [[2, 0]] },
        ],
      }),
    );
    expect(growSettlements(buildings)).toEqual([]);
    expect(houseCount(buildings)).toBe(1);
  });

  it('über die Zeit (Wirtschaft + Wachstum im Tick-Takt) wächst eine über-versorgte Siedlung, bleibt aber begrenzt', () => {
    // Dicker Brot-Vorrat (wie durch Eigenproduktion oder Spieler-Importe). Im echten
    // Tick-Takt (economy.tick + Wachstums-Check alle GROWTH.interval Ticks) kommen
    // Häuser dazu; der Verbrauch der neuen Häuser zehrt am Vorrat und die Obergrenze
    // deckelt — das Wachstum läuft also nicht aus dem Ruder.
    const buildings = town({ bread: 400 }, 2);
    const economy = new Economy(buildings);
    for (let t = 1; t <= GROWTH.interval * 12; t++) {
      economy.tick();
      if (economy.tickCount % GROWTH.interval === 0) growSettlements(buildings);
    }
    expect(houseCount(buildings)).toBeGreaterThan(2); // gewachsen
    expect(houseCount(buildings)).toBeLessThanOrEqual(GROWTH.maxHouses); // begrenzt
  });
});

describe('Besitzer-Trennung in der Wirtschaft', () => {
  function setupOwned(entries: Array<{ t: string; cells: number[][]; o?: string; inv?: Record<string, number> }>) {
    const { buildings } = freshWorld();
    buildings.restore(JSON.stringify({ v: 1, buildings: entries.map((e) => ({ ...e, z: 0 })) }));
    const list = [...buildings.byId.values()].sort((x, y) => x.id - y.id);
    return { buildings, economy: new Economy(buildings), list };
  }

  it('NPC-Arbeiter arbeiten nicht in Spieler-Betrieben', () => {
    const { economy, list } = setupOwned([
      { t: 'house', cells: [[0, 0], [1, 0]], o: 'Eldwik' },
      { t: 'sawmill', cells: [[4, 0]] }, // Spieler, ohne eigenes Wohnhaus
    ]);
    const report = economy.tick();
    expect(stockOf(list[1], 'wood')).toBe(0);
    expect(report.workersTotal).toBe(0); // Spieler-Pool ist leer
  });

  it('NPC-Kontor sammelt keine Spieler-Waren ein und umgekehrt', () => {
    const { economy, list } = setupOwned([
      { t: 'sawmill', cells: [[4, 0]], inv: { wood: 8 } }, // Spieler
      { t: 'tradingPost', cells: [[8, 0]], o: 'Eldwik' },
      { t: 'tradingPost', cells: [[0, 0]] }, // Spieler
    ]);
    economy.tick();
    expect(stockOf(list[1], 'wood')).toBe(0); // NPC bekommt nichts
    expect(stockOf(list[2], 'wood')).toBeGreaterThan(0); // eigenes Kontor schon
  });

  it('Erz-Dorf-Kette: Mine → Erz, Schmiede → Werkzeug (verbraucht eigenes Holz)', () => {
    const { economy, list } = setupOwned([
      { t: 'house', cells: [[0, 0]], o: 'Erzgrund' },
      { t: 'house', cells: [[2, 0]], o: 'Erzgrund' },
      { t: 'mine', cells: [[4, 0]], o: 'Erzgrund' },
      { t: 'smithy', cells: [[6, 0]], o: 'Erzgrund' },
      { t: 'tradingPost', cells: [[8, 0]], o: 'Erzgrund', inv: { wood: 12 } },
    ]);
    const tradingPost = list[4];
    for (let i = 0; i < 12; i++) economy.tick();
    expect(stockOf(tradingPost, 'tools'), 'Schmiede liefert Werkzeug').toBeGreaterThan(0);
    expect(stockOf(tradingPost, 'wood'), 'Holz wird dabei verbraucht').toBeLessThan(12);
  });

  it('Stadt versorgt sich selbst: Hof + Mühle + Bäckerei halten die Häuser über dem Notfall', () => {
    // Dreistufige Nahrungskette Hof (Korn) → Mühle (2 Korn → Mehl) → Bäckerei
    // (1 Mehl → Brot). Die längere Kette bindet 6 Arbeiter — vier brot-versorgte
    // Häuser stellen sie mit Puffer. Mehl-/Korn-Startvorrat überbrückt den Anlauf,
    // Holz deckt die Wartung. Der Brot-Startvorrat (8) wird über 40 Ticks aufgezehrt,
    // die eigene Produktion muss ihn ersetzen, sonst verhungert die Stadt.
    const { economy, list } = setupOwned([
      { t: 'house', cells: [[0, 0]], o: 'Test' }, // hex(0,0)
      { t: 'house', cells: [[2, 0]], o: 'Test' }, // hex(1,0)
      { t: 'house', cells: [[6, 0]], o: 'Test' }, // hex(1,1)
      { t: 'house', cells: [[10, 0]], o: 'Test' }, // hex(2,2)
      { t: 'farm', cells: [[4, 0]], o: 'Test' }, // hex(1,1)
      { t: 'mill', cells: [[8, 0]], o: 'Test' }, // hex(2,1)
      { t: 'bakery', cells: [[12, 0]], o: 'Test' }, // hex(2,2)
      { t: 'tradingPost', cells: [[14, 0]], o: 'Test', inv: { bread: 8, flour: 6, grain: 6, wood: 40 } },
    ]);
    for (let i = 0; i < 40; i++) economy.tick();
    // Brot bleibt im System verfügbar — bei voll versorgten Häusern staut es sich
    // (Kontor/Bäckerei/Hausvorräte), statt zwingend im Kontor zu liegen.
    const brotImSystem = list.reduce((s, b) => s + stockOf(b, 'bread'), 0);
    expect(brotImSystem, 'Brot bleibt verfügbar').toBeGreaterThan(0);
    expect(economy.workersTotal('Test'), 'Stadt über dem Notfall').toBeGreaterThan(2);
  });

  it('NPC-Siedlung wirtschaftet autonom (Hof produziert für das eigene Kontor)', () => {
    const { economy, list } = setupOwned([
      { t: 'house', cells: [[0, 0], [1, 0]], o: 'Tornquist' },
      { t: 'farm', cells: [[4, 0]], o: 'Tornquist' },
      { t: 'tradingPost', cells: [[8, 0]], o: 'Tornquist' },
    ]);
    for (let i = 0; i < 4; i++) economy.tick();
    expect(stockOf(list[2], 'grain')).toBeGreaterThan(0);
    expect(workersOf(list[0])).toBeGreaterThan(0);
  });
});

describe('Handel über Routen', () => {
  function setupTrade() {
    const { buildings } = freshWorld();
    buildings.restore(
      JSON.stringify({
        v: 1,
        buildings: [
          { t: 'tradingPost', z: 0, cells: [[0, 0]], inv: { beer: 8 } }, // Spieler
          { t: 'tradingPost', z: 0, cells: [[60, 0]], o: 'Eldwik', inv: { grain: 10 } },
        ],
      }),
    );
    const list = [...buildings.byId.values()].sort((x, y) => x.id - y.id);
    return { buildings, routes: new Routes(buildings), list };
  }

  it('Verkauf: Entladen am NPC-Kontor bringt Geld', () => {
    const { routes, list } = setupTrade();
    const treasury: Treasury = { money: 0 };
    const res = routes.create(list[0].id, list[1].id, 'beer');
    if (!res.ok) throw new Error(res.reason);
    const travel = routes.travelTicksOf(res.route);
    for (let i = 0; i < 1 + travel + 1; i++) routes.tick(treasury);
    expect(stockOf(list[1], 'beer')).toBe(ROUTE.cartCapacity);
    expect(treasury.money).toBe(ROUTE.cartCapacity * PRICES.beer);
  });

  it('Einkauf: Laden am NPC-Kontor kostet Geld und ist durch den Kontostand begrenzt', () => {
    const { routes, list } = setupTrade();
    const treasury: Treasury = { money: 3 * PRICES.grain + 2 }; // Geld für genau 3 Korn
    const res = routes.create(list[1].id, list[0].id, 'grain');
    if (!res.ok) throw new Error(res.reason);
    routes.tick(treasury); // laden
    expect(res.route.load).toBe(3);
    expect(treasury.money).toBe(2);
    expect(stockOf(list[1], 'grain')).toBe(7);
  });

  it('Rückfracht-Handel: Bier verkaufen und Korn einkaufen in einer Tour', () => {
    const { routes, list } = setupTrade();
    const treasury: Treasury = { money: 100 };
    const res = routes.create(list[0].id, list[1].id, 'beer', 'grain');
    if (!res.ok) throw new Error(res.reason);
    const travel = routes.travelTicksOf(res.route);
    for (let i = 0; i < 4 + 2 * travel; i++) routes.tick(treasury);
    expect(stockOf(list[0], 'grain')).toBe(ROUTE.cartCapacity);
    expect(treasury.money).toBe(100 + ROUTE.cartCapacity * PRICES.beer - ROUTE.cartCapacity * PRICES.grain);
  });

  it('Routen zwischen zwei NPC-Kontoren sind nicht erlaubt', () => {
    const { buildings } = freshWorld();
    buildings.restore(
      JSON.stringify({
        v: 1,
        buildings: [
          { t: 'tradingPost', z: 0, cells: [[0, 0]], o: 'Eldwik' },
          { t: 'tradingPost', z: 0, cells: [[60, 0]], o: 'Tornquist' },
        ],
      }),
    );
    const list = [...buildings.byId.values()];
    const routes = new Routes(buildings);
    expect(routes.create(list[0].id, list[1].id, 'beer').ok).toBe(false);
  });
});
