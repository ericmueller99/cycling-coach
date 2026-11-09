import { createGoal, findGoalForEvent, getEvent, getGoal, updateGoal, type Collections } from '@cycling-coach/db';
import type { Goal, GoalInput, GoalPatch } from '@cycling-coach/shared';
import type { ServiceFailure } from '../app';

/**
 * Goals, with their link to a calendar event (DECISIONS #100). A goal for an event is how the athlete
 * tells the coach to train for it, and how much. It's always an event goal, it's the only goal for
 * that event, and its date is the event's: `CalendarService` and the sync move it when the event moves.
 */

/** The event a goal links to, or why it can't. */
async function linkable(c: Collections, userId: string, eventId: string, goalId?: string): Promise<{ date: string } | ServiceFailure> {
  const event = await getEvent(c, userId, eventId);
  if (!event || event.kind !== 'race') return { error: 'That event isn’t on your calendar.', status: 400 };
  const taken = await findGoalForEvent(c, userId, eventId);
  if (taken && taken.id !== goalId) return { error: 'That event already has a goal.', status: 409 };
  return { date: event.date };
}

export async function addGoal(c: Collections, userId: string, input: GoalInput, now: Date): Promise<Goal | ServiceFailure> {
  if (!input.eventId) return createGoal(c, userId, input, now);
  const link = await linkable(c, userId, input.eventId);
  if ('error' in link) return link;
  return createGoal(c, userId, { ...input, event: true, targetDate: link.date }, now);
}

export async function changeGoal(c: Collections, userId: string, id: string, patch: GoalPatch): Promise<Goal | ServiceFailure | null> {
  const current = await getGoal(c, userId, id);
  if (!current) return null;
  const unlinking = patch.unset?.includes('eventId');
  const eventId = unlinking ? undefined : (patch.eventId ?? current.eventId);
  if (!eventId) return updateGoal(c, userId, id, patch);
  const link = await linkable(c, userId, eventId, id);
  if ('error' in link) {
    if (patch.eventId !== undefined && patch.eventId !== current.eventId) return link;
    // Its event went some other way: the goal carries on, no longer following it.
    return updateGoal(c, userId, id, { ...patch, unset: [...(patch.unset ?? []), 'eventId'] });
  }
  // Linked: an event goal, dated by the event, whatever the patch says.
  const unset = patch.unset?.filter((k) => k !== 'event' && k !== 'targetDate');
  return updateGoal(c, userId, id, { ...patch, eventId, event: true, targetDate: link.date, ...(unset ? { unset } : {}) });
}
