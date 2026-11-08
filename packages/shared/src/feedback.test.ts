import { describe, expect, it } from 'vitest';
import { sessionFeedbackInputSchema } from './feedback';

describe('sessionFeedbackInputSchema', () => {
  const ok = (v: unknown) => sessionFeedbackInputSchema.safeParse(v).success;

  it('takes a rating of a session or a ride', () => {
    expect(ok({ eventId: 'e1', rpe: 6 })).toBe(true);
    expect(ok({ activityId: 'i1', rpe: 6, note: 'Fine' })).toBe(true);
    expect(ok({ eventId: 'e1', activityId: 'i1', rpe: 6 })).toBe(false);
  });

  it('takes a reason on a session — a note and no RPE — and an empty one to clear it (DECISIONS #97)', () => {
    expect(ok({ eventId: 'e1', note: 'Sick with a cold' })).toBe(true);
    expect(ok({ eventId: 'e1', note: '' })).toBe(true);
  });

  it('refuses neither an RPE nor a note, and a ride with no RPE', () => {
    expect(ok({ eventId: 'e1' })).toBe(false);
    expect(ok({ activityId: 'i1', note: 'Sick' })).toBe(false);
  });
});
