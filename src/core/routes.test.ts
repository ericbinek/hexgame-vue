import { describe, expect, it } from 'vitest';
import { Buildings } from './buildings';
import { buildingHex, stockOf } from './economy';
import { hexDistance } from './hex';
import { ROUTE, Routes } from './routes';
import { World } from './world';

function setup(entries: Array<{ t: string; cells: number[][]; inv?: Record<string, number> }>) {
  const world = new World();
  const buildings = new Buildings(world);
  buildings.restore(JSON.stringify({ v: 1, buildings: entries.map((e) => ({ ...e, z: 0 })) }));
  const list = [...buildings.byId.values()].sort((a, b) => a.id - b.id);
  return { buildings, routes: new Routes(buildings), list };
}

describe('Routen-Verwaltung', () => {
  it('verbindet nur zwei verschiedene Kontore; mehrere Wagen pro Strecke erlaubt', () => {
    const { routes, list } = setup([
      { t: 'tradingPost', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[60, 0]] },
      { t: 'house', cells: [[8, 0], [9, 0]] },
    ]);
    expect(routes.create(list[0].id, list[0].id, 'beer').ok).toBe(false);
    expect(routes.create(list[0].id, list[2].id, 'beer').ok).toBe(false);
    expect(routes.create(list[0].id, 999, 'beer').ok).toBe(false);
    expect(routes.create(list[0].id, list[1].id, 'beer').ok).toBe(true);
    expect(routes.create(list[0].id, list[1].id, 'beer').ok).toBe(true); // zweiter Wagen, gleiche Strecke
    expect(routes.create(list[1].id, list[0].id, 'grain').ok).toBe(true); // Gegenrichtung ok
    expect(routes.byId.size).toBe(3);
  });

  it('Abriss eines Endpunkts löst die Route auf', () => {
    const { buildings, routes, list } = setup([
      { t: 'tradingPost', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[60, 0]] },
    ]);
    routes.create(list[0].id, list[1].id, 'beer');
    const cell = list[1].cells[0];
    expect(buildings.removeAt(cell.x, cell.y, 0).ok).toBe(true);
    routes.tick();
    expect(routes.byId.size).toBe(0);
  });
});

describe('Karren-Transport', () => {
  it('voller Zyklus: laden → Hinweg → entladen → Rückweg → wieder laden', () => {
    const { routes, list } = setup([
      { t: 'tradingPost', cells: [[0, 0]], inv: { beer: 10 } },
      { t: 'tradingPost', cells: [[60, 0]] },
    ]);
    const res = routes.create(list[0].id, list[1].id, 'beer');
    if (!res.ok) throw new Error(res.reason);
    const route = res.route;
    const travel = routes.travelTicksOf(route);
    expect(hexDistance(buildingHex(list[0]), buildingHex(list[1]))).toBeGreaterThan(6); // außerhalb des Sammelradius

    routes.tick(); // laden: 8 aufgenommen, Phase hinweg
    expect(route.load).toBe(ROUTE.cartCapacity);
    expect(stockOf(list[0], 'beer')).toBe(2);
    expect(route.phase).toBe('outbound');

    for (let i = 0; i < travel; i++) routes.tick(); // Hinweg + Ankunft
    expect(route.phase).toBe('unloadOut');

    const delivered = routes.tick(); // entladen; ohne Rückfracht direkt zurück
    expect(delivered).toBe(ROUTE.cartCapacity);
    expect(stockOf(list[1], 'beer')).toBe(ROUTE.cartCapacity);
    expect(route.phase).toBe('returnTrip');

    for (let i = 0; i < travel; i++) routes.tick(); // Rückweg
    expect(route.phase).toBe('loadOut');

    routes.tick(); // lädt die restlichen 2
    expect(route.load).toBe(2);
    expect(stockOf(list[0], 'beer')).toBe(0);
  });

  it('ohne Ware wartet der Karren beim Start', () => {
    const { routes, list } = setup([
      { t: 'tradingPost', cells: [[0, 0]] },
      { t: 'tradingPost', cells: [[60, 0]] },
    ]);
    const res = routes.create(list[0].id, list[1].id, 'beer');
    if (!res.ok) throw new Error(res.reason);
    for (let i = 0; i < 5; i++) routes.tick();
    expect(res.route.phase).toBe('loadOut');
    expect(res.route.load).toBe(0);
  });

  it('Rückfracht: liefert hin, lädt am Ziel und entlädt daheim', () => {
    const { routes, list } = setup([
      { t: 'tradingPost', cells: [[0, 0]], inv: { beer: 8 } },
      { t: 'tradingPost', cells: [[60, 0]], inv: { grain: 10 } },
    ]);
    const res = routes.create(list[0].id, list[1].id, 'beer', 'grain');
    if (!res.ok) throw new Error(res.reason);
    const travel = routes.travelTicksOf(res.route);
    routes.tick(); // lädt Bier
    for (let i = 0; i < travel; i++) routes.tick(); // Hinweg
    routes.tick(); // entlädt Bier → Phase ladeRueck
    expect(res.route.phase).toBe('loadReturn');
    routes.tick(); // lädt Korn, fährt los
    expect(res.route.load).toBe(ROUTE.cartCapacity);
    expect(res.route.loadGood).toBe('grain');
    expect(res.route.phase).toBe('returnTrip');
    for (let i = 0; i < travel; i++) routes.tick(); // Rückweg
    routes.tick(); // entlädt daheim
    expect(stockOf(list[0], 'grain')).toBe(ROUTE.cartCapacity);
    expect(stockOf(list[1], 'grain')).toBe(10 - ROUTE.cartCapacity);
    expect(res.route.phase).toBe('loadOut');
  });

  it('Wagen lädt nur den Überschuss über die Min-Reserve', () => {
    const { routes, list } = setup([
      { t: 'tradingPost', cells: [[0, 0]], inv: { beer: 10 } },
      { t: 'tradingPost', cells: [[60, 0]] },
    ]);
    list[0].limits = { beer: { min: 6, max: 40 } }; // 6 Bier als Eigenreserve behalten
    const res = routes.create(list[0].id, list[1].id, 'beer');
    if (!res.ok) throw new Error(res.reason);
    routes.tick(); // laden
    expect(res.route.load).toBe(4); // 10 − 6 Reserve
    expect(stockOf(list[0], 'beer')).toBe(6);
  });

  it('volles Zielkontor: der Karren wartet beim Entladen', () => {
    const { routes, list } = setup([
      { t: 'tradingPost', cells: [[0, 0]], inv: { beer: 8 } },
      { t: 'tradingPost', cells: [[60, 0]], inv: { wood: 40 } }, // 40 × 3 m³ = 120 m³ = Basis-Kapazität, voll
    ]);
    const res = routes.create(list[0].id, list[1].id, 'beer');
    if (!res.ok) throw new Error(res.reason);
    const travel = routes.travelTicksOf(res.route);
    for (let i = 0; i < 1 + travel + 3; i++) routes.tick();
    expect(res.route.phase).toBe('unloadOut'); // hängt fest
    expect(res.route.load).toBe(ROUTE.cartCapacity);

    list[1].inv!.wood = 4; // 12 m³ → Platz für die 8 Bier (8 m³)
    routes.tick();
    expect(stockOf(list[1], 'beer')).toBe(ROUTE.cartCapacity);
    expect(res.route.phase).toBe('returnTrip');
  });
});

describe('Persistenz', () => {
  it('Gebäude-IDs überleben restore — Routen bleiben gültig', () => {
    const { buildings, routes, list } = setup([
      { t: 'house', cells: [[0, 0], [1, 0]] },
      { t: 'tradingPost', cells: [[4, 0]], inv: { beer: 5 } },
      { t: 'tradingPost', cells: [[60, 0]] },
    ]);
    // Wohnhaus abreißen → Lücke in den IDs
    buildings.removeAt(0, 0, 0);
    routes.create(list[1].id, list[2].id, 'beer');
    routes.tick(); // lädt

    const world2 = new World();
    const b2 = new Buildings(world2);
    b2.restore(buildings.serialize());
    expect([...b2.byId.keys()].sort()).toEqual([list[1].id, list[2].id].sort());

    const r2 = new Routes(b2);
    expect(r2.restore(routes.serialize())).toBe(1);
    const route = [...r2.byId.values()][0];
    expect(route.phase).toBe('outbound');
    expect(route.load).toBe(5);
    r2.tick();
    expect(r2.byId.size).toBe(1); // Endpunkte existieren → Route bleibt
  });
});
