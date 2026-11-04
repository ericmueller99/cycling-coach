import { buildZwo, canAddRide, canDeleteSession, todayIn } from '@cycling-coach/core';
import {
  addRideToEvent,
  createEvent,
  deleteEvent,
  detachFeedbackFromEvent,
  findEventByActivity,
  getEvent,
  getProfile,
  getStoredActivity,
  getWorkout,
  patchEvent,
  removeRideFromEvent,
  setEventSync,
  unlinkActivity,
  type Collections,
} from '@cycling-coach/db';
import type { CalendarEvent, CalendarEventInput, CalendarEventPatch, Platform, SessionKind, SessionType } from '@cycling-coach/shared';
import type { ServiceFailure } from '../app';
import type { IntegrationResolver } from '../integrations';
import { IntervalsError } from '../providers/intervals-icu';
import { buildRaceEvent, buildWorkoutEvent } from '../providers/intervals-icu/map';

const isSynced = (e: Pick<CalendarEvent, 'kind'>) => e.kind === 'workout' || e.kind === 'race';

/** Fields that only matter here; changing just these never needs a push. */
const LOCAL_ONLY = new Set(['status', 'activityId', 'extraActivityIds', 'tentative']);

/**
 * Normalise what a session means: races are always race-coloured, and workouts/races default to
 * Zwift. The schema allows these to be omitted; the calendar shouldn't.
 */
function normalise<
  T extends {
    kind?: SessionKind | undefined;
    type?: SessionType | undefined;
    platform?: Platform | undefined;
    priority?: 'A' | 'B' | 'C' | undefined;
  },
>(input: T): T {
  const out = { ...input };
  if (out.kind === 'race') out.type = 'race';
  if ((out.kind === 'workout' || out.kind === 'race') && !out.platform) out.platform = 'zwift';
  if (out.kind === 'race' && !out.priority) out.priority = 'B';
  return out;
}

/**
 * A patch normalised against the stored session. The defaults only fill what neither has: a patch
 * that leaves out `priority` or `platform` (a move, an edit of the time) keeps the stored ones
 * instead of resetting an A race to B or a Garmin race to Zwift.
 */
export function normalisePatch(before: CalendarEvent, patch: CalendarEventPatch): CalendarEventPatch {
  return normalise({
    ...patch,
    kind: patch.kind ?? before.kind,
    platform: patch.platform ?? before.platform,
    priority: patch.priority ?? before.priority,
  });
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

    // Turned into a plain ride: it no longer belongs on intervals.icu.
    if (!isSynced(event) && event.intervals) {
      const removed = await this.unlink(userId, event);
      return 'error' in removed ? { event, syncError: removed.error } : { event: removed };
    }
    const relevant = Object.keys(patch).some((k) => !LOCAL_ONLY.has(k));
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
  async remove(userId: string, id: string): Promise<{ ok: true } | { error: string } | null> {
    const event = await getEvent(this.c, userId, id);
    if (!event) return null;
    if (!canDeleteSession(event)) return { error: "Completed sessions can't be deleted." };
    if (event.intervals) {
      const removed = await this.unlink(userId, event);
      if ('error' in removed) return { error: `Couldn't remove it from intervals.icu: ${removed.error}` };
    }
    await deleteEvent(this.c, userId, id);
    return { ok: true };
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
