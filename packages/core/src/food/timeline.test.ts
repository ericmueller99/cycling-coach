import type { FoodLogEntry } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { dayTimeline, isFuelSlot, type TimelineItem } from './timeline';

const entry = (slot: string, kcal: number, time?: string): FoodLogEntry => ({
  id: `${slot}-${kcal}`,
  date: '2026-11-01',
  slot,
  ...(time ? { time } : {}),
  kind: 'food',
  refId: 'f',
  name: 'Food',
  source: 'manual',
  quantity: 1,
  unit: 'serving',
  servings: 1,
  nutrients: { kcal, protein: 1, carbs: 1, fat: 1 },
  via: 'manual',
  createdAt: '2026-11-01T00:00:00Z',
});
const SLOTS = [
  { name: 'Breakfast', time: '07:30' },
  { name: 'Lunch', time: '12:30' },
  { name: 'Dinner', time: '18:30' },
  { name: 'Workout fuel' },
  { name: 'Snacks' },
];
type S = { id: string; time?: string | undefined; pending?: boolean };
const kinds = (items: TimelineItem<S>[]) =>
  items.map((x) => (x.kind === 'meal' ? x.slot : x.kind === 'session' ? `session:${x.session.id}` : 'now'));

describe('dayTimeline', () => {
  it('orders meals and sessions by time and nests workout fuel under the ride', () => {
    const items = dayTimeline<S>({
      entries: [entry('Breakfast', 400, '07:40'), entry('Workout fuel', 200, '10:30'), entry('Dinner', 700), entry('Lunch', 600, '13:05')],
      slots: SLOTS,
      sessions: [{ id: 'z2', time: '09:15' }],
      now: '15:00',
    });
    expect(kinds(items)).toEqual(['Breakfast', 'session:z2', 'Lunch', 'now', 'Dinner']);
    const ride = items[1]!;
    expect(ride.kind === 'session' && ride.fuel?.kcal).toBe(200);
    expect(items[0]!.kind === 'meal' && items[0]!.time).toBe('07:40');
  });

  it('puts an untimed session mid-day and keeps fuel as a meal with no session', () => {
    expect(kinds(dayTimeline<S>({ entries: [entry('Breakfast', 400), entry('Lunch', 500)], slots: SLOTS, sessions: [{ id: 'race' }] }))).toEqual(['Breakfast', 'session:race', 'Lunch']);
    expect(kinds(dayTimeline<S>({ entries: [entry('Workout fuel', 200)], slots: SLOTS, sessions: [] }))).toEqual(['Workout fuel']);
  });

  it('hands fuel to the session nearest its time', () => {
    const items = dayTimeline<S>({ entries: [entry('Workout fuel', 150, '18:10')], slots: SLOTS, sessions: [{ id: 'am', time: '07:00' }, { id: 'pm', time: '17:45' }] });
    const pm = items.find((x) => x.kind === 'session' && x.session.id === 'pm');
    expect(pm?.kind === 'session' && pm.fuel?.kcal).toBe(150);
  });

  it('puts a session still to do just below now when its time is unknown or past', () => {
    const at = (sessions: S[], now?: string) => kinds(dayTimeline<S>({ entries: [], slots: SLOTS, sessions, now, includeEmpty: true }));
    expect(at([{ id: 'z2', pending: true }], '10:00')).toEqual(['Breakfast', 'now', 'session:z2', 'Lunch', 'Dinner', 'Snacks']);
    expect(at([{ id: 'z2', time: '07:00', pending: true }], '10:00')).toEqual(['Breakfast', 'now', 'session:z2', 'Lunch', 'Dinner', 'Snacks']);
    expect(at([{ id: 'race', time: '18:00', pending: true }], '10:00')).toEqual(['Breakfast', 'now', 'Lunch', 'session:race', 'Dinner', 'Snacks']);
    expect(at([{ id: 'z2', pending: true }])).toEqual(['Breakfast', 'session:z2', 'Lunch', 'Dinner', 'Snacks']);
    expect(at([{ id: 'done', time: '07:00' }], '10:00')).toEqual(['session:done', 'Breakfast', 'now', 'Lunch', 'Dinner', 'Snacks']);
    const late = dayTimeline<S>({ entries: [], slots: SLOTS, sessions: [{ id: 'z2', time: '07:00', pending: true }], now: '10:00' });
    expect(late.find((x) => x.kind === 'session')?.time).toBe('07:00');
  });

  it('keeps empty slots in order when asked (untimed ones after the slot before them)', () => {
    expect(kinds(dayTimeline<S>({ entries: [], slots: SLOTS, sessions: [{ id: 'z2', time: '16:00' }], includeEmpty: true }))).toEqual([
      'Breakfast',
      'Lunch',
      'session:z2',
      'Dinner',
      'Snacks',
    ]);
  });

  it('knows the fuel slot by either name', () => {
    expect(isFuelSlot('Workout fuel')).toBe(true);
    expect(isFuelSlot('Ride fuel')).toBe(true);
    expect(isFuelSlot('Snacks')).toBe(false);
  });
});
