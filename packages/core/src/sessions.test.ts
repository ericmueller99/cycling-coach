import type { CalendarEvent } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { canDeleteSession, classifyWorkout, previewCalendarChange } from './sessions';
import { STANDARD_COOLDOWN, STANDARD_WARMUP, STARTER_WORKOUTS } from './starter-library';

it('lets only sessions that were never ridden be deleted', () => {
  expect(canDeleteSession({ status: 'planned' })).toBe(true);
  expect(canDeleteSession({ status: 'missed' })).toBe(true);
  expect(canDeleteSession({ status: 'skipped' })).toBe(true);
  expect(canDeleteSession({ status: 'done', activityId: 'a' })).toBe(false);
  expect(canDeleteSession({ status: 'done' })).toBe(false);
  // Marked planned again by hand, but the sync already matched it to a ride.
  expect(canDeleteSession({ status: 'planned', activityId: 'a' })).toBe(false);
  expect(canDeleteSession({ status: 'planned', extraActivityIds: ['b'] })).toBe(false);
});

const event: CalendarEvent = {
  id: 'e1',
  date: '2026-11-05',
  kind: 'workout',
  platform: 'zwift',
  type: 'intervals',
  title: 'Threshold 3x12',
  workoutId: 'w1',
  durationMin: 73,
  tentative: false,
  status: 'planned',
  source: 'coach',
};

it('previews an add as a new session with nothing before it', () => {
  const add = { op: 'add' as const, event: { date: '2026-10-31', kind: 'workout' as const, type: 'intervals' as const, title: 'VO2 5x4', workoutId: 'w2', tentative: false } };
  expect(previewCalendarChange(add, null)).toEqual({ before: null, after: add.event, changed: [], missing: false });
});

it('previews a move as a date change', () => {
  const p = previewCalendarChange({ op: 'move', eventId: 'e1', toDate: '2026-11-04' }, event);
  expect(p.after?.date).toBe('2026-11-04');
  expect(p.changed).toEqual(['date']);
});

it('lists only the fields an update actually changes', () => {
  const p = previewCalendarChange({ op: 'update', eventId: 'e1', patch: { title: 'Threshold 3x12', durationMin: 60, workoutId: 'w3' } }, event);
  expect(p.changed).toEqual(['duration', 'workoutId']);
  expect(p.after).toMatchObject({ title: 'Threshold 3x12', durationMin: 60, workoutId: 'w3', date: '2026-11-05' });
});

it('previews a remove as the session going away', () => {
  expect(previewCalendarChange({ op: 'remove', eventId: 'e1' }, event)).toEqual({ before: event, after: null, changed: [], missing: false });
});

it('flags a change whose event did not exist when proposed', () => {
  expect(previewCalendarChange({ op: 'remove', eventId: 'gone' }, null).missing).toBe(true);
  // Proposals stored before snapshots existed: unknown, not missing.
  expect(previewCalendarChange({ op: 'remove', eventId: 'e1' }, undefined).missing).toBe(false);
});

it('leaves a time off row out of the session preview, and never calls it missing', () => {
  const entry = { kind: 'sick', startDate: '2026-11-05', endDate: '2026-11-07' } as const;
  const empty = { before: null, after: null, changed: [], missing: false };
  expect(previewCalendarChange({ op: 'time_off_add', entry }, null)).toEqual(empty);
  expect(previewCalendarChange({ op: 'time_off_update', timeOffId: 't1', entry, was: entry }, null)).toEqual(empty);
  expect(previewCalendarChange({ op: 'time_off_remove', timeOffId: 't1', was: entry }, null)).toEqual(empty);
});

describe('classifyWorkout', () => {
  const withWarmup = (...main: Parameters<typeof classifyWorkout>[0]) => [...STANDARD_WARMUP, ...main, ...STANDARD_COOLDOWN];

  it("files sweet spot as sweet spot, not VO2, despite the warm-up's 1 min @ 110%", () => {
    expect(classifyWorkout(withWarmup({ kind: 'repeat', count: 2, steps: [{ durSec: 1200, pct: 90 }, { durSec: 300, pct: 55 }] }))).toBe('Sweet spot');
    expect(classifyWorkout(withWarmup({ kind: 'steady', durSec: 1200, pct: 91 }, { kind: 'steady', durSec: 300, pct: 55 }, { kind: 'steady', durSec: 1200, pct: 91 }))).toBe('Sweet spot');
  });

  it('reads threshold, VO2 and tempo main sets', () => {
    expect(classifyWorkout(withWarmup({ kind: 'repeat', count: 2, steps: [{ durSec: 900, pct: 100 }, { durSec: 300, pct: 55 }] }))).toBe('Threshold');
    expect(classifyWorkout(withWarmup({ kind: 'repeat', count: 6, steps: [{ durSec: 180, pct: 116 }, { durSec: 180, pct: 50 }] }))).toBe('VO2 max');
    expect(classifyWorkout(withWarmup({ kind: 'steady', durSec: 2400, pct: 80 }))).toBe('Tempo');
  });

  it('keeps an easy ride with a little tempo as endurance', () => {
    expect(classifyWorkout([{ kind: 'steady', durSec: 3600, pct: 68 }, { kind: 'steady', durSec: 600, pct: 80 }])).toBe('Endurance');
    expect(classifyWorkout([{ kind: 'steady', durSec: 1800, pct: 50 }])).toBe('Recovery');
  });

  it('tells sprints from openers', () => {
    expect(classifyWorkout(withWarmup({ kind: 'repeat', count: 8, steps: [{ durSec: 15, pct: 180 }, { durSec: 285, pct: 60 }] }))).toBe('Sprint');
    expect(classifyWorkout(withWarmup({ kind: 'repeat', count: 3, steps: [{ durSec: 30, pct: 130 }, { durSec: 120, pct: 55 }] }))).toBe('Openers');
  });

  it('agrees with every starter workout but the ones only a name can tell (race prep, the test)', () => {
    for (const w of STARTER_WORKOUTS) {
      if (w.category === 'Race prep' || w.category === 'Test') continue;
      expect([w.name, classifyWorkout(w.segments)]).toEqual([w.name, w.category]);
    }
  });
});
