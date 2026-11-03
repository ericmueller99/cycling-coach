import { eventQuerySchema, type EventQueryInput, type ZwiftEvent, type ZwiftEventPen } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { eligibility, queryEvents, z2Wkg, type EventAthlete } from './query';

const athlete: EventAthlete = { ftp: 345, weightKg: 85.5, zwiftWeightKg: 83, zftp: 330, zmap: 420, category: 'B', racingScore: 696 };
const ctx = { now: new Date('2026-10-31T15:00:00Z'), timeZone: 'America/Vancouver' }; // Sat Oct 31, 08:00 local
const none = { signedUpPenIds: new Map<number, number[]>(), calendarEventIds: new Map<number, string>() };

let nextId = 1;
const pen = (label: number, p: Partial<ZwiftEventPen> = {}): ZwiftEventPen => ({
  id: nextId++,
  label,
  name: 'ABCDE'[label - 1]!,
  start: '2026-10-31T17:00:00.000Z',
  km: 30,
  ascentM: 150,
  terrain: 'rolling',
  rules: [],
  signedUp: 10,
  ...p,
});

const event = (p: Partial<ZwiftEvent> = {}): ZwiftEvent => ({
  id: nextId++,
  name: 'Race',
  type: 'race',
  start: '2026-10-31T17:00:00.000Z',
  world: 'Watopia',
  categoryEnforced: false,
  rules: [],
  tags: [],
  signedUp: 50,
  friends: 0,
  penKind: 'category',
  pens: [pen(1), pen(2), pen(3)],
  unlocks: [],
  ranked: false,
  womenOnly: false,
  seenVia: 'public',
  ...p,
});

const q = (input: EventQueryInput) => eventQuerySchema.parse(input);
const ids = (r: { items: { id: number }[] }) => r.items.map((i) => i.id);

describe('eligibility', () => {
  it('zFTP-enforced category: his own pen is the easiest he may enter', () => {
    const e = event({ categoryEnforced: true });
    const me = eligibility(e, athlete);
    expect(me).toMatchObject({ canEnter: true, basis: 'zftp', myPenId: e.pens[1]!.id });
    expect(me.enterablePenIds).toEqual([e.pens[0]!.id, e.pens[1]!.id]);
  });

  it('Racing Score range pens', () => {
    const e = event({
      categoryEnforced: true,
      pens: [pen(1, { rangeLabel: '650-1000' }), pen(2, { rangeLabel: '510-650' }), pen(3, { rangeLabel: '0-510' })],
    });
    expect(eligibility(e, athlete)).toMatchObject({ canEnter: true, basis: 'racing_score', myPenId: e.pens[0]!.id });
  });

  it("an expression he can't meet", () => {
    const e = event({ access: '(subgroup.label == 1 && scoring.current <= 650) || (subgroup.label == 2 && scoring.current < 510)' });
    expect(eligibility(e, athlete)).toMatchObject({ canEnter: false, enterablePenIds: [] });
  });

  it('an expression that only bans riders keeps the category rule of an enforced event', () => {
    const e = event({ categoryEnforced: true, access: 'profile.profileId != 6170996', pens: [pen(3), pen(4)] });
    expect(eligibility(e, { ...athlete, zwiftId: 1 })).toMatchObject({ canEnter: false });
    const open = event({ categoryEnforced: false, access: 'profile.profileId != 6170996', pens: [pen(3), pen(4)] });
    expect(eligibility(open, { ...athlete, zwiftId: 1 }).canEnter).toBe(true);
  });

  it("an expression we can't read is 'check in Zwift'", () => {
    const e = event({ access: 'scoring.max30 < 600' });
    expect(eligibility(e, athlete).canEnter).toBeNull();
  });

  it('women-only is never enterable; distance options and open pens always are', () => {
    expect(eligibility(event({ womenOnly: true }), athlete).canEnter).toBe(false);
    expect(eligibility(event({ penKind: 'distance' }), athlete)).toMatchObject({ canEnter: true, basis: 'open' });
    expect(eligibility(event(), athlete)).toMatchObject({ canEnter: true, basis: 'open' });
  });
});

describe('z2Wkg', () => {
  it('Z2 at Zwift FTP over Zwift weight', () => {
    const [lo, hi] = z2Wkg(athlete);
    expect(lo).toBeCloseTo(193 / 83, 2);
    expect(hi).toBeCloseTo(259 / 83, 2);
  });
});

describe('queryEvents', () => {
  it('filters by type, with facet counts that ignore their own filter', () => {
    const race = event();
    const ride = event({ type: 'group_ride', penKind: 'pace' });
    const tt = event({ type: 'tt', penKind: 'none', world: 'Makuri Islands' });
    const r = queryEvents([race, ride, tt], q({ filters: { types: ['race'] } }), athlete, none, ctx);
    expect(ids(r)).toEqual([race.id]);
    expect(r.facets.types).toEqual({ race: 1, group_ride: 1, tt: 1 });
    expect(r.facets.worlds).toEqual({ Watopia: 1 });
    expect(r).toMatchObject({ total: 1, all: 3 });
  });

  it('today / tomorrow and time of day in his time zone', () => {
    const tonight = event({ start: '2026-11-01T02:00:00.000Z' }); // Sat 19:00 local
    const sunday = event({ start: '2026-11-01T17:00:00.000Z' }); // Sun 09:00 local
    expect(ids(queryEvents([tonight, sunday], q({ filters: { day: 'today' } }), athlete, none, ctx))).toEqual([tonight.id]);
    expect(ids(queryEvents([tonight, sunday], q({ filters: { day: 'tomorrow' } }), athlete, none, ctx))).toEqual([sunday.id]);
    expect(ids(queryEvents([tonight, sunday], q({ filters: { timesOfDay: ['evening'] } }), athlete, none, ctx))).toEqual([tonight.id]);
    expect(ids(queryEvents([tonight, sunday], q({ filters: { from: '08:30', to: '10:00' } }), athlete, none, ctx))).toEqual([sunday.id]);
  });

  it('distance options match if ANY option fits, and say which', () => {
    const long = pen(1, { name: 'Long', km: 112 });
    const short = pen(2, { name: 'Short', km: 26 });
    const fondo = event({ type: 'group_ride', penKind: 'distance', pens: [long, short] });
    const r = queryEvents([fondo, event()], q({ filters: { lengthMin: 100 } }), athlete, none, ctx);
    expect(ids(r)).toEqual([fondo.id]);
    expect(r.items[0]!.me.matchedPenIds).toEqual([long.id]);
  });

  it('length in minutes uses each pen’s estimate', () => {
    const quick = event({ pens: [pen(1, { km: 20, ascentM: 50 })] });
    const long = event({ pens: [pen(1, { km: 90, ascentM: 600 })] });
    expect(ids(queryEvents([quick, long], q({ filters: { lengthUnit: 'min', lengthMin: 60 } }), athlete, none, ctx))).toEqual([long.id]);
    expect(queryEvents([quick], q({}), athlete, none, ctx).items[0]!.pens[0]!.estMin).toBeGreaterThan(20);
  });

  it('"I can enter" hides only events he definitely can\'t enter; women-only hidden by default', () => {
    const closed = event({ access: 'scoring.current < 500' });
    const unknown = event({ access: 'scoring.max30 < 600' });
    const women = event({ womenOnly: true });
    const open = event();
    const r = queryEvents([closed, unknown, women, open], q({}), athlete, none, ctx);
    expect(ids(r).sort()).toEqual([unknown.id, open.id].sort());
    expect(ids(queryEvents([closed, women], q({ filters: { canEnter: false, hideWomenOnly: false } }), athlete, none, ctx))).toHaveLength(2);
  });

  it('fits Z2: a group-ride pace group inside his Z2 W/kg', () => {
    const easy = event({ type: 'group_ride', penKind: 'pace', pens: [pen(1, { paceFrom: 3.2, paceTo: 3.6 }), pen(2, { paceFrom: 2.4, paceTo: 2.9 })] });
    const hard = event({ type: 'group_ride', penKind: 'pace', pens: [pen(1, { paceFrom: 3.3, paceTo: 3.8 })] });
    expect(ids(queryEvents([easy, hard], q({ filters: { fitsZ2: true } }), athlete, none, ctx))).toEqual([easy.id]);
  });

  it('rules, popularity, unlocks, series, search', () => {
    const noPu = event({ rules: ['NO_POWERUPS'], signedUp: 80, unlocks: ['kit'], series: 'zrl', name: 'ZRL Round 1' });
    const plain = event({ signedUp: 5 });
    const run = (filters: EventQueryInput['filters']) => ids(queryEvents([noPu, plain], q({ filters }), athlete, none, ctx));
    expect(run({ powerups: 'no' })).toEqual([noPu.id]);
    expect(run({ powerups: 'yes' })).toEqual([plain.id]);
    expect(run({ minSignedUp: 50 })).toEqual([noPu.id]);
    expect(run({ hasUnlock: true })).toEqual([noPu.id]);
    expect(run({ series: ['zrl'] })).toEqual([noPu.id]);
    expect(run({ q: 'round 1' })).toEqual([noPu.id]);
  });

  it('signed up and on my calendar', () => {
    const a = event();
    const b = event();
    const user = { signedUpPenIds: new Map([[a.id, [a.pens[1]!.id]]]), calendarEventIds: new Map([[b.id, 'cal1']]) };
    expect(ids(queryEvents([a, b], q({ filters: { signedUpOnly: true } }), athlete, user, ctx))).toEqual([a.id]);
    const onCal = queryEvents([a, b], q({ filters: { onCalendar: true } }), athlete, user, ctx);
    expect(ids(onCal)).toEqual([b.id]);
    expect(onCal.items[0]!.me.calendarEventId).toBe('cal1');
  });

  it('sorts and pages', () => {
    const small = event({ start: '2026-10-31T16:00:00.000Z', signedUp: 5, pens: [pen(1, { km: 20, ascentM: 900 })] });
    const big = event({ start: '2026-10-31T18:00:00.000Z', signedUp: 200, pens: [pen(1, { km: 80, ascentM: 100 })] });
    const run = (sort: 'start' | 'pop' | 'km' | 'elev') => ids(queryEvents([big, small], q({ sort }), athlete, none, ctx));
    expect(run('start')).toEqual([small.id, big.id]);
    expect(run('pop')).toEqual([big.id, small.id]);
    expect(run('km')).toEqual([big.id, small.id]);
    expect(run('elev')).toEqual([small.id, big.id]);
    const page = queryEvents([big, small], q({ offset: 1, limit: 1 }), athlete, none, ctx);
    expect(ids(page)).toEqual([big.id]);
    expect(page.total).toBe(2);
  });

  it('upcoming only (default) hides started events; off shows the last hour for late join', () => {
    const started = event({ start: '2026-10-31T14:50:00.000Z' });
    const later = event();
    expect(ids(queryEvents([started, later], q({}), athlete, none, ctx))).toEqual([later.id]);
    expect(ids(queryEvents([started, later], q({ filters: { upcoming: false } }), athlete, none, ctx))).toEqual([started.id, later.id]);
  });

  it('drops events that started over an hour ago', () => {
    const old = event({ start: '2026-10-31T13:30:00.000Z' });
    expect(queryEvents([old], q({ filters: { upcoming: false } }), athlete, none, ctx).all).toBe(0);
  });
});
