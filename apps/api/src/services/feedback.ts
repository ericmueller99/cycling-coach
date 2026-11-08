import { combineRides, sessionCompliance, sessionRideIds } from '@cycling-coach/core';
import { deleteReasonForEvent, getEvent, getProfile, getWorkout, upsertFeedback, type Collections } from '@cycling-coach/db';
import type { SessionFeedback, SessionFeedbackInput, SessionResult } from '@cycling-coach/shared';
import type { ServiceFailure as Failure } from '../app';
import type { TrainingData } from './training-data';

const intervalsOff: Failure = { error: 'intervals.icu is not configured on the server.', status: 503 };

/**
 * Ride feedback and the completed-session view (DECISIONS #30). Ratings are only
 * stored — the coach reads them when it pulls rides or the calendar; nothing calls Claude here.
 */
export class FeedbackService {
  constructor(
    private readonly c: Collections,
    private readonly training: TrainingData | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Rate a completed session, or a ride nothing was planned for. A missed or skipped session takes a
   * reason instead: a note with no RPE, which the coach reads as why it didn't happen (DECISIONS #97).
   * An empty reason clears it.
   */
  async save(userId: string, input: SessionFeedbackInput): Promise<SessionFeedback | { cleared: true } | Failure> {
    const rating = { rpe: input.rpe, note: input.note };
    if (input.eventId) {
      const event = await getEvent(this.c, userId, input.eventId);
      if (!event) return { error: 'Session not found.', status: 404 };
      if (event.status === 'missed' || event.status === 'skipped') {
        if (input.rpe !== undefined) return { error: 'Missed and skipped sessions take a note, not a rating.', status: 409 };
        if (!input.note?.trim()) {
          await deleteReasonForEvent(this.c, userId, event.id);
          return { cleared: true };
        }
        return upsertFeedback(this.c, userId, { eventId: event.id, date: event.date, title: event.title, workoutId: event.workoutId, note: input.note }, this.now());
      }
      if (event.status !== 'done') return { error: 'Only completed sessions can be rated.', status: 409 };
      if (input.rpe === undefined) return { error: 'Pick an RPE from 1 to 10.', status: 400 };
      return upsertFeedback(
        this.c,
        userId,
        { eventId: event.id, activityId: event.activityId, date: event.date, title: event.title, workoutId: event.workoutId, ...rating },
        this.now(),
      );
    }
    if (input.rpe === undefined) return { error: 'Pick an RPE from 1 to 10.', status: 400 };
    if (!this.training) return intervalsOff;
    const ride = await this.training.detail(userId, input.activityId!);
    if (!ride) return { error: 'Ride not found — it may not have synced yet.', status: 404 };
    return upsertFeedback(
      this.c,
      userId,
      { activityId: ride.activity.id, date: ride.activity.startLocal.slice(0, 10), title: ride.activity.name, ...rating },
      this.now(),
    );
  }

  /**
   * A completed session's rides and, for a library workout, its reps against the plan — computed
   * from the synced rides and their stored intervals (DECISIONS #49), never stored itself. A session
   * ridden in pieces (DECISIONS #32) adds up its rides and walks their intervals in order.
   */
  async result(userId: string, eventId: string): Promise<SessionResult | Failure> {
    const event = await getEvent(this.c, userId, eventId);
    if (!event) return { error: 'Session not found.', status: 404 };
    if (!event.activityId) return { error: 'This session has no matched ride.', status: 409 };
    if (!this.training) return intervalsOff;
    const training = this.training;
    const found = await Promise.all(sessionRideIds(event).map((id) => training.detail(userId, id)));
    const details = found.filter((d) => d !== null);
    if (!details.length) return { error: "This session's ride hasn't synced yet.", status: 503 };
    const primary = details[0]!;
    details.sort((a, b) => a.activity.startLocal.localeCompare(b.activity.startLocal));
    const [workout, profile] = await Promise.all([
      event.workoutId ? getWorkout(this.c, userId, event.workoutId) : null,
      getProfile(this.c, userId),
    ]);
    // Targets as ridden: the FTP intervals.icu had on the day, else today's.
    const ftp = primary.activity.ftp ?? profile?.ftpZwift;
    const rides = details.map((d) => d.activity);
    return {
      activity: primary.activity,
      rides,
      totals: combineRides(rides),
      compliance: workout && ftp ? sessionCompliance(workout.segments, ftp, details.flatMap((d) => d.intervals)) : null,
    };
  }
}
