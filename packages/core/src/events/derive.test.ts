import { describe, expect, it } from 'vitest';
import { deriveEvent, penKindOf, seriesOf, unlocksOf, type ZwiftEventSource, type ZwiftPenSource } from './derive';
import { estimateMinutes, penLength, terrainFor, worldName, type ZwiftRoute } from './routes';

const TEMPUS: ZwiftRoute = { id: 2128890027, name: 'Tempus Fugit', world: 'Watopia', distanceM: 17231.3, ascentM: 25.6, leadinM: 2355.5, leadinAscentM: 6.2 };
const ALPE: ZwiftRoute = { id: 2, name: 'Road to Sky', world: 'Watopia', distanceM: 12200, ascentM: 1036, leadinM: 5000, leadinAscentM: 30 };
const routes = new Map([TEMPUS, ALPE].map((r) => [r.id, r]));
const routeOf = (id: number | undefined) => (id === undefined ? undefined : routes.get(id));

const pen = (label: number, p: Partial<ZwiftPenSource> = {}): ZwiftPenSource => ({
  id: 100 + label,
  label,
  start: '2026-10-31T17:00:00.000Z',
  routeId: TEMPUS.id,
  laps: 2,
  rules: [],
  tags: [],
  signedUp: 10 * label,
  ...p,
});

const source = (p: Partial<ZwiftEventSource> = {}): ZwiftEventSource => ({
  id: 1,
  name: 'Evening Race',
  eventType: 'RACE',
  sport: 'CYCLING',
  start: '2026-10-31T17:00:00.000Z',
  mapId: 1,
  categoryEnforced: true,
  rules: [],
  tags: [],
  signedUp: 150,
  friends: 0,
  pens: [1, 2, 3, 4, 5].map((l) => pen(l)),
  ...p,
});

describe('routes', () => {
  it('distance = lead-in + laps × route; climbing likewise', () => {
    expect(penLength({ laps: 2 }, TEMPUS)).toEqual({ km: 36.8, ascentM: 57 });
    expect(penLength({}, TEMPUS)).toEqual({ km: 19.6, ascentM: 32 });
  });

  it("uses the pen's own distance, scaling the climbing", () => {
    expect(penLength({ distanceM: 40_000 }, TEMPUS)).toEqual({ km: 40, ascentM: 62 });
    expect(penLength({ distanceM: 40_000 }, undefined)).toEqual({ km: 40 });
    expect(penLength({ laps: 3 }, undefined)).toEqual({});
  });

  it('terrain from metres per km', () => {
    expect([terrainFor(40, 100), terrainFor(40, 300), terrainFor(40, 600), terrainFor(17, 1036)]).toEqual(['flat', 'rolling', 'hilly', 'mountain']);
  });

  it('estimates ride time roughly like Zwift', () => {
    expect(estimateMinutes(40, 200, 3)).toBeGreaterThan(65);
    expect(estimateMinutes(40, 200, 3)).toBeLessThan(80);
    // The Alpe at 3 W/kg: about an hour.
    expect(estimateMinutes(12.2, 1036, 3)).toBeGreaterThan(55);
    expect(estimateMinutes(12.2, 1036, 3)).toBeLessThan(75);
  });

  it('world from mapId, else from the route', () => {
    expect(worldName(9, undefined)).toBe('Makuri Islands');
    expect(worldName(undefined, TEMPUS)).toBe('Watopia');
  });
});

describe('penKindOf', () => {
  it('race categories', () => expect(penKindOf(source())).toBe('category'));

  it('a single start', () => expect(penKindOf(source({ eventType: 'TIME_TRIAL', pens: [pen(1)] }))).toBe('none'));

  it('group-ride pace groups', () => {
    const pens = [pen(1, { paceFrom: 3.5, paceTo: 4 }), pen(2, { paceFrom: 2.8, paceTo: 3.4 }), pen(3, { paceFrom: 2.2, paceTo: 2.7 })];
    expect(penKindOf(source({ eventType: 'GROUP_RIDE', categoryEnforced: false, pens }))).toBe('pace');
  });

  it('distance options: different routes, one shared pace, no rules (Tour of Watopia)', () => {
    const pens = [pen(1, { routeId: ALPE.id, laps: 1, paceFrom: 1, paceTo: 5 }), pen(2, { laps: 1, paceFrom: 1, paceTo: 5 }), pen(3, { laps: 2, paceFrom: 1, paceTo: 5 })];
    expect(penKindOf(source({ eventType: 'GROUP_RIDE', categoryEnforced: false, pens }))).toBe('distance');
  });

  it('distance options on a race (Everesting 25 % / 50 %)', () => {
    const pens = [pen(1, { laps: 0, distanceM: 110_240, paceFrom: 1, paceTo: 6 }), pen(2, { laps: 0, distanceM: 56_327, paceFrom: 1, paceTo: 6 })];
    expect(penKindOf(source({ categoryEnforced: false, pens }))).toBe('distance');
  });

  it('different lap counts with different paces stay pace groups', () => {
    const pens = [pen(3, { laps: 8 }), pen(4, { laps: 6, paceFrom: 1.8, paceTo: 2.5 })];
    expect(penKindOf(source({ eventType: 'GROUP_RIDE', categoryEnforced: false, pens }))).toBe('pace');
  });
});

describe('deriveEvent', () => {
  it('derives per-pen distance, terrain and the event range', () => {
    const e = deriveEvent(source(), routeOf, 'public')!;
    expect(e).toMatchObject({ type: 'race', world: 'Watopia', route: 'Tempus Fugit', penKind: 'category', kmMin: 36.8, kmMax: 36.8, seenVia: 'public' });
    expect(e.pens.map((p) => [p.name, p.km, p.terrain])).toEqual([
      ['A', 36.8, 'flat'],
      ['B', 36.8, 'flat'],
      ['C', 36.8, 'flat'],
      ['D', 36.8, 'flat'],
      ['E', 36.8, 'flat'],
    ]);
  });

  it('names distance options from the pen name', () => {
    const pens = [
      pen(1, { name: 'Long - Stage 5 - Tour of Watopia 2026', routeId: ALPE.id, laps: 1, paceFrom: 1, paceTo: 5 }),
      pen(2, { name: 'Short - Stage 5 - Tour of Watopia 2026', laps: 1, paceFrom: 1, paceTo: 5 }),
    ];
    const e = deriveEvent(source({ name: 'Stage 5 - Tour of Watopia 2026', eventType: 'GROUP_RIDE', categoryEnforced: false, pens }), routeOf, 'public')!;
    expect(e.pens.map((p) => [p.name, p.km, p.terrain])).toEqual([
      ['Long', 17.2, 'mountain'],
      ['Short', 19.6, 'flat'],
    ]);
    expect(e).toMatchObject({ penKind: 'distance', series: 'tour_of_watopia', kmMin: 17.2, kmMax: 19.6 });
  });

  it('keeps a time-based pen as minutes, not km', () => {
    const e = deriveEvent(source({ eventType: 'GROUP_WORKOUT', pens: [pen(1, { durationS: 3600 })] }), routeOf, 'public')!;
    expect(e.pens[0]).toMatchObject({ durationMin: 60, km: undefined });
    expect(e.type).toBe('workout');
  });

  it('drops running and unknown types', () => {
    expect(deriveEvent(source({ sport: 'RUNNING' }), routeOf, 'public')).toBeNull();
    expect(deriveEvent(source({ eventType: 'MEETUP' }), routeOf, 'public')).toBeNull();
  });

  it('flags women-only, ranked and the earliest pen start', () => {
    const pens = [pen(1, { start: '2026-10-31T17:02:00.000Z' }), pen(2, { start: '2026-10-31T17:00:00.000Z' })];
    const e = deriveEvent(source({ rules: ['LADIES_ONLY'], tags: ['ranked'], pens }), routeOf, 'public')!;
    expect(e).toMatchObject({ womenOnly: true, ranked: true, start: '2026-10-31T17:00:00.000Z' });
  });

  it('trims long descriptions', () => {
    const e = deriveEvent(source({ description: 'x'.repeat(2000) }), routeOf, 'public')!;
    expect(e.description).toHaveLength(600);
  });
});

describe('series and unlocks', () => {
  it('recognises series', () => {
    expect(seriesOf('ZRL Round 1 - Race', undefined, [])).toBe('zrl');
    expect(seriesOf('Stage 5', 'Tour of Watopia 2026 - Ride Stage 5', [])).toBe('tour_of_watopia');
    expect(seriesOf('Club ride', undefined, [])).toBeUndefined();
  });

  it('reads unlocks from tags and description', () => {
    expect(unlocksOf(['jerseyunlock'], undefined)).toEqual(['kit']);
    expect(unlocksOf([], 'Finish to unlock the Pas Normal Studios kit in your Zwift locker.')).toEqual(['kit']);
    expect(unlocksOf([], 'Earn the route badge and unlock a new bike frame.')).toEqual(['route_badge', 'bike']);
    expect(unlocksOf(['ranked'], 'A hard race.')).toEqual([]);
  });
});
