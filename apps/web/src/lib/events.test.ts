import { DEFAULT_EVENT_FILTERS, type EventItem, type ZwiftEventPen } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { activeChips, calendarInputFor, datesLabel, dayOptions, withDate } from './events';

const pen = (extra: Partial<ZwiftEventPen> = {}): ZwiftEventPen => ({ id: 11, label: 2, name: 'B', start: '2027-01-12T18:00:00.000Z', rules: [], signedUp: 40, ...extra });

const event = (pens: ZwiftEventPen[], extra: Partial<EventItem> = {}): EventItem => ({
  id: 4242,
  name: 'Made-up Ladder Race',
  type: 'race',
  start: '2027-01-12T18:00:00.000Z',
  world: 'Watopia',
  route: 'Volcano Circuit',
  categoryEnforced: false,
  rules: [],
  tags: [],
  signedUp: 40,
  friends: 0,
  penKind: 'category',
  pens,
  unlocks: [],
  ranked: true,
  womenOnly: false,
  seenVia: 'public',
  me: { canEnter: true, myPenId: 11, enterablePenIds: [11], matchedPenIds: [], fitsZ2: false, signedUpPenIds: [] },
  ...extra,
});

describe('calendarInputFor: a Zwift race’s route (DECISIONS #102)', () => {
  it('carries the pen’s route and laps', () => {
    const input = calendarInputFor(event([pen({ routeId: 686828068, laps: 6 })]), 'UTC');
    expect(input).toMatchObject({ kind: 'race', zwiftEventId: 4242, zwiftPenId: 11, zwiftRouteId: 686828068, zwiftLaps: 6 });
  });

  it('carries the route alone for a timed pen', () => {
    const input = calendarInputFor(event([pen({ routeId: 686828068, durationMin: 30 })]), 'UTC');
    expect(input.zwiftRouteId).toBe(686828068);
    expect(input).not.toHaveProperty('zwiftLaps');
  });

  it('leaves both off a group ride, and off a pen with no route', () => {
    expect(calendarInputFor(event([pen({ routeId: 686828068, laps: 2 })], { type: 'group_ride' }), 'UTC')).not.toHaveProperty('zwiftRouteId');
    expect(calendarInputFor(event([pen()]), 'UTC')).not.toHaveProperty('zwiftRouteId');
  });
});

describe('calendarInputFor: the pen they signed up for (DECISIONS #116)', () => {
  it('beats the pen we would pick, with its own start and route', () => {
    const a = pen({ id: 10, label: 1, name: 'A', start: '2027-01-12T18:00:00.000Z', routeId: 1, laps: 3 });
    const c = pen({ id: 12, label: 3, name: 'C', start: '2027-01-12T18:02:00.000Z', routeId: 2, laps: 2 });
    const e = event([a, pen(), c], { me: { canEnter: true, myPenId: 11, enterablePenIds: [10, 11, 12], matchedPenIds: [], fitsZ2: false, signedUpPenIds: [12] } });
    expect(calendarInputFor(e, 'UTC')).toMatchObject({ zwiftPenId: 12, startTime: '18:02', zwiftRouteId: 2, zwiftLaps: 2, meta: 'Watopia · Volcano Circuit · Pen C' });
  });
});

describe('the When day strip', () => {
  const today = '2026-11-20'; // a Friday
  const f = DEFAULT_EVENT_FILTERS;

  it('lists Any, Today, Tomorrow, then each synced day', () => {
    const days = dayOptions(f, today, '2026-11-26');
    expect(days.map((d) => `${d.label} ${d.sub}`.trim())).toEqual(['Any', 'Today 20', 'Tomorrow 21', 'Sun 22', 'Mon 23', 'Tue 24', 'Wed 25', 'Thu 26']);
    expect(days.filter((d) => d.on).map((d) => d.key)).toEqual(['all']);
    // The public feed alone still offers Today and Tomorrow; never more than two weeks.
    expect(dayOptions(f, today, undefined)).toHaveLength(3);
    expect(dayOptions(f, today, '2027-01-30')).toHaveLength(16);
  });

  it('Today stays relative; a later day is a date; picking it again goes back to Any', () => {
    const days = dayOptions(f, today, '2026-11-26');
    const todayF = days.find((d) => d.key === 'today')!.pick(f);
    expect(todayF).toMatchObject({ day: 'today' });
    expect(todayF).not.toHaveProperty('dateFrom');
    const sunday = days.find((d) => d.key === '2026-11-22')!.pick(todayF);
    expect(sunday).toMatchObject({ day: 'all', dateFrom: '2026-11-22', dateTo: '2026-11-22' });
    const again = dayOptions(sunday, today, '2026-11-26');
    expect(again.filter((d) => d.on).map((d) => d.key)).toEqual(['2026-11-22']);
    const back = again.find((d) => d.key === '2026-11-22')!.pick(sunday);
    expect(back).not.toHaveProperty('dateFrom');
    expect(back.day).toBe('all');
  });

  it('a From/To span drops the relative day, and shows as one chip', () => {
    const span = withDate(withDate({ ...f, day: 'today' }, 'dateFrom', '2026-11-22'), 'dateTo', '2026-11-24');
    expect(span).toMatchObject({ day: 'all', dateFrom: '2026-11-22', dateTo: '2026-11-24' });
    const chip = activeChips(span).find((c) => c.key === 'dates')!;
    expect(chip.label).toBe('Nov 22–24');
    expect(chip.clear(span)).not.toHaveProperty('dateFrom');
    expect(withDate(span, 'dateTo', '')).not.toHaveProperty('dateTo');
  });

  it('labels', () => {
    expect(datesLabel('2026-11-22', '2026-11-22')).toBe('Sun Nov 22');
    expect(datesLabel('2026-11-29', '2026-12-02')).toBe('Nov 29–Dec 2');
    expect(datesLabel('2026-11-22', undefined)).toBe('From Nov 22');
    expect(datesLabel(undefined, '2026-11-24')).toBe('Until Nov 24');
  });
});
