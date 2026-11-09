import { analyzeCourse, buildZwo, canAddRide, canDeleteSession, COURSE_ANALYSIS_VERSION, todayIn } from '@cycling-coach/core';
import {
  addRideToEvent,
  createEvent,
  createTimeOff,
  deleteCourse,
  deleteGoalForEvent,
  deleteEvent,
  deleteTimeOff,
  deleteReasonForEvent,
  redateReasonForEvent,
  redateGoalForEvent,
  unlinkGoalFromEvent,
  detachFeedbackFromEvent,
  findEventByActivity,
  getEvent,
  getProfile,
  getStoredActivity,
  getTimeOff,
  getWorkout,
  patchEvent,
  patchTimeOff,
  putCourse,
  setEventCourse,
  removeRideFromEvent,
  setEventSync,
  unlinkActivity,
  type Collections,
} from '@cycling-coach/db';
import {
  timeOffRangeError,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventPatch,
  type Course,
  type CourseInput,
  type EventInfo,
  type Platform,
  type SessionKind,
  type SessionType,
  type TimeOff,
  type TimeOffInput,
  type TimeOffPatch,
} from '@cycling-coach/shared';
import type { ServiceFailure } from '../app';
import type { IntegrationResolver } from '../integrations';
import { IntervalsError } from '../providers/intervals-icu';
import { buildRaceEvent, buildWorkoutEvent } from '../providers/intervals-icu/map';
import { readCourse } from './course';
import type { ZwiftRouteCourses } from './zwift-route-course';

const isSynced = (e: Pick<CalendarEvent, 'kind'>) => e.kind === 'workout' || e.kind === 'race';

/** Fields that only matter here; changing (or clearing) just these never needs a push. */
const LOCAL_ONLY = new Set(['status', 'activityId', 'extraActivityIds', 'tentative', 'zwiftRouteId', 'zwiftLaps']);

/**
 * Normalise what a session means: races are always race-coloured, and workouts/races default to
 * Zwift. The schema allows these to be omitted; the calendar shouldn't. Event details belong to
 * races alone (DECISIONS #98): a patch can't put them on anything else.
 */
function normalise<
  T extends {
    kind?: SessionKind | undefined;
    type?: SessionType | undefined;
    platform?: Platform | undefined;
    priority?: 'A' | 'B' | 'C' | undefined;
    eventInfo?: EventInfo | undefined;
  },
>(input: T): T {
  const out = { ...input };
  if (out.kind === 'race') out.type = 'race';
  if ((out.kind === 'workout' || out.kind === 'race') && !out.platform) out.platform = 'zwift';
  if (out.kind === 'race' && !out.priority) out.priority = 'B';
  if (out.kind !== 'race') delete out.eventInfo;
  return out;
}

/**
 * A patch normalised against the stored session. The defaults only fill what neither has: a patch
 * that leaves out `priority` or `platform` (a move, an edit of the time) keeps the stored ones
 * instead of resetting an A race to B or a Garmin race to Zwift.
 */
export function normalisePatch(before: CalendarEvent, patch: CalendarEventPatch): CalendarEventPatch {
  const out = normalise({
    ...patch,
    kind: patch.kind ?? before.kind,
    platform: patch.platform ?? before.platform,
    priority: patch.priority ?? before.priority,
  });
  // A race turned into something else leaves its event details behind.
  if (out.kind !== 'race' && before.eventInfo) out.unset = [...new Set([...(out.unset ?? []), 'eventInfo' as const])];
  return out;
}

/**
 * Every calendar write goes through here (routes, accepted coach proposals, sync imports are the
 * exception — they come *from* intervals.icu). Workouts and races are pushed to intervals.icu
 * straight away, which forwards workouts to Zwift; rides stay local (docs/DECISIONS.md #16).
 *
 * A failed push never blocks the local change. It's recorded (`intervals.error` or `syncError`)
 * and retried by the next sync, and until then the local version wins.
 */
export class CalendarService {
  constructor(
    private readonly c: Collections,
    private readonly integrations: Pick<IntegrationResolver, 'intervalsFor'>,
    private readonly authorName: (userId: string) => Promise<string>,
    private readonly now: () => Date = () => new Date(),
    /** Appended to pushed workout names; the sync strips it from names it reads back (DECISIONS #63). */
    readonly eventNameSuffix?: string,
    /** After a failed push, so a retry doesn't have to wait for a slow poll (DECISIONS #75). */
    private readonly onPushFailed?: (userId: string) => Promise<void>,
    /** A race that follows a Zwift route gets its course from the route (DECISIONS #102). */
    private readonly routeCourses?: Pick<ZwiftRouteCourses, 'course'>,
  ) {}

  async create(
    userId: string,
    input: CalendarEventInput,
    meta: { source: 'coach' | 'manual'; proposalId?: string | undefined },
  ): Promise<CalendarEvent> {
    const event = await createEvent(this.c, userId, normalise(input), meta, this.now());
    return isSynced(event) ? this.push(userId, event) : event;
  }

  async patch(userId: string, id: string, patch: CalendarEventPatch): Promise<{ event: CalendarEvent; syncError?: string } | null> {
    const before = await getEvent(this.c, userId, id);
    if (!before) return null;
    let event = await patchEvent(this.c, userId, id, normalisePatch(before, patch), this.now());
    if (!event) return null;
    // "Mark not done": a rating of a session that didn't happen goes with it.
    if (before.status === 'done' && event.status !== 'done') await detachFeedbackFromEvent(this.c, userId, id, this.now());
    // Undo Skip, Mark done: the reason it didn't happen no longer holds (DECISIONS #97).
    const didntHappen = (s: CalendarEvent['status']) => s === 'missed' || s === 'skipped';
    if (didntHappen(before.status) && !didntHappen(event.status)) await deleteReasonForEvent(this.c, userId, id);
    else if (event.date !== before.date) await redateReasonForEvent(this.c, userId, id, event.date, this.now());
    // An event's goal is dated by the event (DECISIONS #100).
    if (event.date !== before.date) await redateGoalForEvent(this.c, userId, id, event.date);

    // Turned into a plain ride: it no longer belongs on intervals.icu.
    if (!isSynced(event) && event.intervals) {
      const removed = await this.unlink(userId, event);
      return 'error' in removed ? { event, syncError: removed.error } : { event: removed };
    }
    const changed = [...Object.keys(patch).filter((k) => k !== 'unset'), ...(patch.unset ?? [])];
    const relevant = changed.some((k) => !LOCAL_ONLY.has(k));
    if (isSynced(event) && relevant) {
      event = await this.push(userId, event);
      const error = event.intervals?.error ?? event.syncError;
      return error ? { event, syncError: error } : { event };
    }
    return { event };
  }

  /**
   * Deletes on intervals.icu first. If that fails the local session stays — deleting only ours
   * would let the next sync re-import it from intervals.icu as if it were new. Completed sessions
   * can't be deleted at all (DECISIONS #24).
   */
  async remove(userId: string, id: string, opts: { removeGoal?: boolean } = {}): Promise<{ ok: true } | { error: string } | null> {
    const event = await getEvent(this.c, userId, id);
    if (!event) return null;
    if (!canDeleteSession(event)) return { error: "Completed sessions can't be deleted." };
    if (event.intervals) {
      const removed = await this.unlink(userId, event);
      if ('error' in removed) return { error: `Couldn't remove it from intervals.icu: ${removed.error}` };
    }
    await deleteEvent(this.c, userId, id);
    // Only a session that wasn't ridden gets here, so a reason is all the feedback it could have.
    await deleteReasonForEvent(this.c, userId, id);
    await deleteCourse(this.c, userId, id);
    // Its goal goes too if the athlete said so; otherwise it stays, no longer following an event.
    if (opts.removeGoal) await deleteGoalForEvent(this.c, userId, id);
    else await unlinkGoalFromEvent(this.c, userId, id);
    return { ok: true };
  }

  /**
   * An event's course (DECISIONS #99), analysed again when the analysis has changed since it was stored.
   * Null when there is none.
   */
  async course(userId: string, id: string): Promise<Course | null> {
    const event = await getEvent(this.c, userId, id);
    if (!event) return null;
    // A race on a Zwift route shows the route, for accounts with the Zwift feature (DECISIONS #102).
    if (event.zwiftRouteId !== undefined && this.routeCourses) {
      const fromRoute = await this.routeCourses.course(userId, event);
      if (fromRoute) return fromRoute;
    }
    return readCourse(this.c, userId, id);
  }

  /**
   * Adds or replaces a race's course. The track comes from the browser; the analysis is ours. Nothing is
   * pushed: intervals.icu doesn't hold courses.
   */
  async putCourse(userId: string, id: string, input: CourseInput): Promise<Course | ServiceFailure | null> {
    const event = await getEvent(this.c, userId, id);
    if (!event) return null;
    if (event.kind !== 'race') return { error: 'Only an event has a course.', status: 400 };
    if (event.zwiftRouteId !== undefined) return { error: 'This race follows a Zwift route.', status: 400 };
    const stored = await putCourse(this.c, userId, id, input, analyzeCourse(input.points), COURSE_ANALYSIS_VERSION, this.now());
    if (event.courseId !== stored.id) await setEventCourse(this.c, userId, id, stored.id, this.now());
    return stored.course;
  }

  async removeCourse(userId: string, id: string): Promise<boolean> {
    const event = await getEvent(this.c, userId, id);
    if (!event) return false;
    await deleteCourse(this.c, userId, id);
    if (event.courseId) await setEventCourse(this.c, userId, id, null, this.now());
    return true;
  }

  /**
   * The matched ride wasn't this session: unpair them for good — the sync skips that ride for this
   * session from now on — and send the session back to planned (or missed, once its day is over).
   * The rating stays with the ride. Local only: nothing changes on intervals.icu.
   */
  async unlinkRide(userId: string, id: string): Promise<CalendarEvent | { error: string } | null> {
    const event = await getEvent(this.c, userId, id);
    if (!event) return null;
    if (!event.activityId) return { error: 'This session has no matched ride.' };
    const profile = await getProfile(this.c, userId);
    const now = this.now();
    const status = event.date < todayIn(profile?.timezone ?? 'UTC', now) ? 'missed' : 'planned';
    const unlinked = await unlinkActivity(this.c, userId, id, status, now);
    if (unlinked) await detachFeedbackFromEvent(this.c, userId, id, now);
    return unlinked;
  }

  /**
   * Group a same-day ride into a session — a long ride split across several Zwift activities
   * (DECISIONS #32). Only ever the user's action. A session with no ride yet takes it as its matched
   * ride and becomes done. Local only: rides are never written to intervals.icu.
   */
  async addRide(userId: string, id: string, activityId: string): Promise<CalendarEvent | ServiceFailure | null> {
    const event = await getEvent(this.c, userId, id);
    if (!event) return null;
    const ride = await getStoredActivity(this.c, userId, activityId);
    if (!ride) return { error: 'Ride not found — it may not have synced yet.', status: 404 };
    const check = canAddRide(event, ride.activity);
    if (!check.ok) return { error: check.reason, status: 409 };
    const owner = await findEventByActivity(this.c, userId, activityId);
    if (owner && owner.id !== id) return { error: `That ride already belongs to "${owner.title}". Remove it there first.`, status: 409 };
    return addRideToEvent(this.c, userId, id, activityId, this.now());
  }

  /**
   * Take a ride out of a session. Removing the last one sends the session back to planned (or
   * missed) and its rating to the ride, as unlinking does.
   */
  async removeRide(userId: string, id: string, activityId: string): Promise<CalendarEvent | ServiceFailure | null> {
    const event = await getEvent(this.c, userId, id);
    if (!event) return null;
    if (event.activityId !== activityId && !event.extraActivityIds?.includes(activityId)) return { error: "That ride isn't part of this session.", status: 409 };
    const profile = await getProfile(this.c, userId);
    const now = this.now();
    const status = event.date < todayIn(profile?.timezone ?? 'UTC', now) ? 'missed' : 'planned';
    const updated = await removeRideFromEvent(this.c, userId, id, activityId, status, now);
    if (updated && !updated.activityId) await detachFeedbackFromEvent(this.c, userId, id, now);
    return updated;
  }

  /** Vacation or sick days. They stay in this app, so nothing here pushes (DECISIONS #87). */
  addTimeOff(userId: string, input: TimeOffInput, meta: { source: 'coach' | 'manual'; proposalId?: string | undefined }): Promise<TimeOff> {
    return createTimeOff(this.c, userId, input, meta, this.now());
  }

  /** The dates are checked as they'll end up: a patch can carry just one of them. */
  async patchTimeOff(userId: string, id: string, patch: TimeOffPatch): Promise<TimeOff | ServiceFailure | null> {
    const before = await getTimeOff(this.c, userId, id);
    if (!before) return null;
    const error = timeOffRangeError(patch.startDate ?? before.startDate, patch.endDate ?? before.endDate);
    if (error) return { error, status: 400 };
    return patchTimeOff(this.c, userId, id, patch, this.now());
  }

  removeTimeOff(userId: string, id: string): Promise<boolean> {
    return deleteTimeOff(this.c, userId, id);
  }

  /** Create or update the session's intervals.icu event. Records the link, or the error. */
  async push(userId: string, event: CalendarEvent): Promise<CalendarEvent> {
    if (!isSynced(event)) return event;
    const icu = await this.integrations.intervalsFor(userId);
    if (!icu) return event;
    const now = this.now();
    try {
      const body = await this.bodyFor(userId, event);
      let eventId = event.intervals?.eventId;
      let uid = event.intervals?.uid;
      let updated: string | undefined;
      if (eventId !== undefined) {
        try {
          updated = (await icu.updateEvent(eventId, body)).updated;
        } catch (err) {
          // Deleted over there while we edited here: our edit is the newer intent, so recreate it.
          if (!(err instanceof IntervalsError && err.status === 404)) throw err;
          eventId = undefined;
        }
      }
      if (eventId === undefined) {
        const created = await icu.createEvent(body);
        eventId = created.id;
        uid = created.uid;
        updated = created.updated;
      }
      return (
        (await setEventSync(
          this.c,
          userId,
          event.id,
          { intervals: { eventId, uid, remoteUpdated: updated, syncedAt: now.toISOString() }, syncError: null },
          now,
        )) ?? event
      );
    } catch (err) {
      const message = (err as Error).message;
      const sync = event.intervals ? { intervals: { ...event.intervals, error: message } } : { syncError: message };
      const saved = await setEventSync(this.c, userId, event.id, sync, now);
      await this.onPushFailed?.(userId);
      return saved ?? event;
    }
  }

  private async bodyFor(userId: string, event: CalendarEvent) {
    if (event.kind === 'race') return buildRaceEvent(event);
    if (!event.workoutId) throw new Error('This workout session has no library workout.');
    const workout = await getWorkout(this.c, userId, event.workoutId);
    if (!workout) throw new Error('Its library workout no longer exists.');
    return buildWorkoutEvent(event, workout, buildZwo(workout, { author: await this.authorName(userId) }), this.eventNameSuffix);
  }

  private async unlink(userId: string, event: CalendarEvent): Promise<CalendarEvent | { error: string }> {
    if (!event.intervals) return event;
    const icu = await this.integrations.intervalsFor(userId);
    if (!icu) return { error: 'intervals.icu is not connected' };
    try {
      await icu.deleteEvent(event.intervals.eventId);
    } catch (err) {
      return { error: (err as Error).message };
    }
    return (await setEventSync(this.c, userId, event.id, { intervals: null, syncError: null }, this.now())) ?? event;
  }
}
