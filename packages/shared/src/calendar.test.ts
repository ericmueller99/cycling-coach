import { describe, expect, it } from 'vitest';
import { calendarChangeSchema } from './coach';
import { calendarEventInputSchema, calendarEventPatchSchema } from './calendar';

describe('calendar schemas', () => {
  it('applies defaults when creating a session', () => {
    expect(calendarEventInputSchema.parse({ date: '2026-11-05', type: 'endurance', title: 'Z2' })).toMatchObject({ kind: 'ride', tentative: false });
  });

  // Regression: a defaulted field inside .partial() turned every move into "kind: ride", which
  // un-synced the workout and deleted it from intervals.icu.
  it('never injects defaults into a patch', () => {
    expect(calendarEventPatchSchema.parse({ date: '2027-01-15' })).toEqual({ date: '2027-01-15' });
    expect(calendarEventPatchSchema.parse({ status: 'done' })).toEqual({ status: 'done' });
    expect(calendarChangeSchema.parse({ op: 'update', eventId: 'e', patch: { title: 'x' } })).toEqual({ op: 'update', eventId: 'e', patch: { title: 'x' } });
  });

  it('never lets a patch set the rides of a session', () => {
    expect(calendarEventPatchSchema.parse({ title: 'x', activityId: 'a', extraActivityIds: ['b'] })).toEqual({ title: 'x' });
  });

  it('lets an edit clear optional fields, but only those', () => {
    expect(calendarEventPatchSchema.parse({ unset: ['startTime', 'coachNote'] })).toEqual({ unset: ['startTime', 'coachNote'] });
    expect(calendarEventPatchSchema.safeParse({ unset: ['title'] }).success).toBe(false);
    expect(calendarEventPatchSchema.safeParse({ unset: ['workoutId'] }).success).toBe(false);
  });

  it('never offers the coach an unset', () => {
    expect(calendarChangeSchema.parse({ op: 'update', eventId: 'e', patch: { title: 'x', unset: ['startTime'] } })).toEqual({ op: 'update', eventId: 'e', patch: { title: 'x' } });
  });

  it('requires a library workout for workout sessions', () => {
    expect(calendarEventInputSchema.safeParse({ date: '2026-11-05', kind: 'workout', type: 'intervals', title: 'VO2' }).success).toBe(false);
  });
});

it('never injects goal defaults into a patch (editing the main goal must not un-main it)', async () => {
  const { goalPatchSchema } = await import('./profile');
  expect(goalPatchSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
});
