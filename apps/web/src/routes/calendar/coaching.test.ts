import type { Goal } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { coachingFor, coachingSummary, eventGoalInput, eventGoalPatch, NO_COACHING } from './coaching';

const event = { id: 'e7', title: 'Coast Range Gran Fondo', date: '2027-09-11' };

describe('the coaching questions (DECISIONS #100)', () => {
  it('turn Yes · Important · Compete into a goal for the event', () => {
    expect(eventGoalInput(event, { q1: 'yes', weight: 'important', aim: 'compete', note: ' Front group ' })).toEqual({
      horizon: 'long',
      title: 'Coast Range Gran Fondo',
      event: true,
      targetDate: '2027-09-11',
      eventId: 'e7',
      weight: 'important',
      aim: 'compete',
      detail: 'Front group',
      primary: false,
      done: false,
    });
  });

  it('make Main goal the primary goal, keeping Important to fall back to; no weight picked is Keep in mind', () => {
    expect(eventGoalInput(event, { ...NO_COACHING, q1: 'yes', weight: 'main' })).toMatchObject({ primary: true, weight: 'important' });
    expect(eventGoalInput(event, { ...NO_COACHING, q1: 'yes' })).toMatchObject({ primary: false, weight: 'in_mind' });
  });

  it('read back from a goal and change only what changed', () => {
    const goal = { id: 'g1', horizon: 'long', title: 'x', eventId: 'e7', weight: 'important', aim: 'compete', detail: 'Front group', primary: true, done: false } as Goal;
    expect(coachingFor(goal)).toEqual({ q1: 'yes', weight: 'main', aim: 'compete', note: 'Front group' });
    expect(eventGoalPatch(goal, { q1: 'yes', weight: 'in_mind', aim: null, note: '' })).toEqual({ weight: 'in_mind', primary: false, unset: ['aim', 'detail'] });
    expect(coachingSummary(goal)).toBe('Main goal · Aim: Compete');
    expect(coachingSummary({ ...goal, primary: false, aim: undefined })).toBe('Important');
  });
});
