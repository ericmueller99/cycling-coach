import type { CalendarActivity, CalendarEvent } from '@cycling-coach/shared';
import { expect, it } from 'vitest';
import { groupByDay, weekSummary } from './agenda';
import { weekDates } from './dates';

const ev = (id: string, date: string, status: CalendarEvent['status'], durationMin: number): CalendarEvent => ({
  id,
  date,
  kind: 'workout',
  type: 'intervals',
  title: id,
  durationMin,
  tentative: false,
  status,
  source: 'coach',
});

const ride = (id: string, startLocal: string, movingSec: number, matchedEventId?: string): CalendarActivity => ({
  id,
  name: id,
  type: 'VirtualRide',
  startLocal,
  distanceM: 0,
  movingSec,
  elapsedSec: movingSec,
  ...(matchedEventId ? { matchedEventId } : {}),
});

it('groups sessions and rides by local date, keeping only unclaimed rides as rides', () => {
  const m = groupByDay([ev('a', '2026-10-27', 'done', 60)], [ride('r1', '2026-10-27T18:00:00', 3600, 'a'), ride('r2', '2026-10-27T07:00:00', 1800)]);
  const day = m.get('2026-10-27')!;
  expect(day.events.map((e) => e.id)).toEqual(['a']);
  expect(day.rides.map((r) => r.id)).toEqual(['r2']);
  expect(day.ridden).toBe(90);
});

it('counts a session ridden in pieces once, with every ride in its minutes', () => {
  // The server tags grouped rides with the session too (sessionRideIds).
  const m = groupByDay(
    [ev('z2', '2026-10-27', 'done', 120)],
    [ride('long', '2026-10-27T09:00:00', 84 * 60, 'z2'), ride('loop', '2026-10-27T10:30:00', 27 * 60, 'z2')],
  );
  const day = m.get('2026-10-27')!;
  expect(day.rides).toEqual([]);
  expect(day.ridden).toBe(111);
  expect(weekSummary(weekDates('2026-10-30'), '2026-10-30', m)).toEqual({ minutes: 111, done: 1, planned: 0 });
});

it('sums ridden minutes before today and planned minutes from today on', () => {
  const week = weekDates('2026-10-30');
  const m = groupByDay(
    [
      ev('mon', '2026-10-26', 'done', 60),
      ev('wed', '2026-10-28', 'missed', 45),
      ev('fri', '2026-10-30', 'planned', 45),
      ev('sat', '2026-10-31', 'skipped', 40),
      ev('sun', '2026-11-01', 'planned', 150),
    ],
    [ride('r1', '2026-10-26T18:00:00', 3000, 'mon'), ride('r2', '2026-10-27T18:00:00', 1800)],
  );
  // 50 + 30 ridden (the planned 60 on Monday doesn't count) + 45 + 150 planned; skipped excluded.
  expect(weekSummary(week, '2026-10-30', m)).toEqual({ minutes: 275, done: 2, planned: 2 });
});

it('is empty for a week with nothing on it', () => {
  expect(weekSummary(weekDates('2026-12-07'), '2026-10-30', new Map())).toEqual({ minutes: 0, done: 0, planned: 0 });
});
