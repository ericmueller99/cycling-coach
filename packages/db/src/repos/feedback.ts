import type { IsoDate, SessionFeedback } from '@cycling-coach/shared';
import type { Collections, SessionFeedbackDoc } from '../collections';
import { compact, idOf } from './util';

const toFeedback = (doc: SessionFeedbackDoc): SessionFeedback => {
  const { _id, userId: _u, createdAt, updatedAt, ...rest } = doc;
  return compact({ ...rest, id: idOf(doc), createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() });
};

export interface FeedbackWrite {
  eventId?: string | undefined;
  activityId?: string | undefined;
  date: IsoDate;
  title: string;
  workoutId?: string | undefined;
  /** Absent for a reason (DECISIONS #97). */
  rpe?: number | undefined;
  note?: string | undefined;
}

/**
 * Create or edit a rating. A session's rating is found by its event — or by its ride, if the ride
 * was rated before the sync matched it to the session, which folds that rating into the session.
 * An empty note clears it. A write without `rpe` is a missed session's reason, and a rating saved over a
 * reason replaces its note.
 */
export async function upsertFeedback(c: Collections, userId: string, f: FeedbackWrite, now: Date): Promise<SessionFeedback> {
  const filter = f.eventId
    ? {
        userId,
        $or: [{ eventId: f.eventId }, ...(f.activityId ? [{ activityId: f.activityId, eventId: { $exists: false } }] : [])],
      }
    : { userId, activityId: f.activityId!, eventId: { $exists: false } };
  const note = f.note?.trim();
  const unset: Record<string, ''> = {};
  if (!note) unset['note'] = '';
  if (!f.workoutId) unset['workoutId'] = '';
  if (f.rpe === undefined) unset['rpe'] = '';
  const doc = await c.sessionFeedback.findOneAndUpdate(
    filter,
    {
      $set: compact({ eventId: f.eventId, activityId: f.activityId, date: f.date, title: f.title, workoutId: f.workoutId, rpe: f.rpe, note: note || undefined, updatedAt: now }),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      $setOnInsert: { userId, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return toFeedback(doc!);
}

/** Ratings dated within a range (local dates, inclusive), newest first. */
export async function listFeedback(
  c: Collections,
  userId: string,
  range: { from: IsoDate; to: IsoDate; workoutId?: string | undefined },
): Promise<SessionFeedback[]> {
  const docs = await c.sessionFeedback
    .find({ userId, date: { $gte: range.from, $lte: range.to }, ...(range.workoutId ? { workoutId: range.workoutId } : {}) })
    .sort({ date: -1, createdAt: -1 })
    .toArray();
  return docs.map(toFeedback);
}

export async function feedbackForActivities(c: Collections, userId: string, activityIds: readonly string[]): Promise<SessionFeedback[]> {
  if (!activityIds.length) return [];
  const docs = await c.sessionFeedback.find({ userId, activityId: { $in: [...activityIds] } }).toArray();
  return docs.map(toFeedback);
}

/** A session lost its ride (unlink): its rating stays with the ride, as an unplanned ride's. */
export async function detachFeedbackFromEvent(c: Collections, userId: string, eventId: string, now: Date) {
  const doc = await c.sessionFeedback.findOne({ userId, eventId });
  if (!doc) return;
  if (doc.activityId) await c.sessionFeedback.updateOne({ _id: doc._id }, { $unset: { eventId: '', workoutId: '' }, $set: { updatedAt: now } });
  else await c.sessionFeedback.deleteOne({ _id: doc._id });
}

/** Drop a session's reason — never a rating (DECISIONS #97). */
export async function deleteReasonForEvent(c: Collections, userId: string, eventId: string): Promise<void> {
  await c.sessionFeedback.deleteOne({ userId, eventId, rpe: { $exists: false } });
}

/** A session with a reason moved to another day: the reason goes with it, so date reads still find it. */
export async function redateReasonForEvent(c: Collections, userId: string, eventId: string, date: IsoDate, now: Date): Promise<void> {
  await c.sessionFeedback.updateOne({ userId, eventId, rpe: { $exists: false } }, { $set: { date, updatedAt: now } });
}
