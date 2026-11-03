import type { CalendarEvent, CalendarEventInput, CalendarEventPatch, ClearableEventField, IntervalsLink, IsoDate } from '@cycling-coach/shared';
import type { UpdateFilter } from 'mongodb';
import type { CalendarEventDoc, Collections } from '../collections';
import { compact, idOf, oid } from './util';

export const toEvent = (doc: CalendarEventDoc): CalendarEvent => {
  const { _id, userId: _u, createdAt: _c, updatedAt: _t, ...rest } = doc;
  return compact({ ...rest, kind: rest.kind ?? 'ride', id: idOf(doc) });
};

export async function listEvents(
  c: Collections,
  userId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<CalendarEvent[]> {
  const docs = await c.calendarEvents
    .find({ userId, date: { $gte: from, $lte: to } })
    .sort({ date: 1, createdAt: 1 })
    .toArray();
  return docs.map(toEvent);
}

export async function getEvent(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.calendarEvents.findOne({ _id, userId });
  return doc ? toEvent(doc) : null;
}

export async function createEvent(
  c: Collections,
  userId: string,
  input: CalendarEventInput,
  meta: {
    source: 'coach' | 'manual' | 'intervals';
    proposalId?: string | undefined;
    intervals?: IntervalsLink | undefined;
    status?: CalendarEvent['status'] | undefined;
  },
  now: Date,
): Promise<CalendarEvent> {
  const doc: CalendarEventDoc = compact({
    ...input,
    userId,
    status: meta.status ?? ('planned' as const),
    source: meta.source,
    proposalId: meta.proposalId,
    intervals: meta.intervals,
    createdAt: now,
    updatedAt: now,
  });
  const res = await c.calendarEvents.insertOne(doc);
  return toEvent({ ...doc, _id: res.insertedId });
}

export async function patchEvent(
  c: Collections,
  userId: string,
  id: string,
  patch: CalendarEventPatch & { activityId?: string | undefined },
  now: Date,
) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.calendarEvents.findOneAndUpdate({ _id, userId }, eventPatchUpdate(patch, now), { returnDocument: 'after' });
  return doc ? toEvent(doc) : null;
}

/** The Mongo update for a patch: `$set` what it sets, `$unset` what it clears (a set value wins). */
export function eventPatchUpdate(patch: CalendarEventPatch & { activityId?: string | undefined }, now: Date): UpdateFilter<CalendarEventDoc> {
  const { unset, ...fields } = patch;
  const set = { ...compact(fields), updatedAt: now };
  const cleared = (unset ?? []).filter((k) => !(k in set));
  if (!cleared.length) return { $set: set };
  const $unset: { [K in ClearableEventField]?: '' } = {};
  for (const k of cleared) $unset[k] = '';
  return { $set: set, $unset };
}

/**
 * Undo a match: drop the ride, set the status the session goes back to, and remember the ride so
 * the next sync doesn't pair them again. (`patchEvent` only sets, it can't unset `activityId`.)
 */
export async function unlinkActivity(
  c: Collections,
  userId: string,
  id: string,
  status: 'planned' | 'missed',
  now: Date,
) {
  const _id = oid(id);
  if (!_id) return null;
  const current = await c.calendarEvents.findOne({ _id, userId });
  if (!current?.activityId) return null;
  const doc = await c.calendarEvents.findOneAndUpdate(
    { _id, userId },
    // Grouped rides go back to being unplanned rides; only the matched one is remembered as unlinked.
    { $set: { status, updatedAt: now }, $unset: { activityId: '', extraActivityIds: '' }, $addToSet: { ignoredActivityIds: current.activityId } },
    { returnDocument: 'after' },
  );
  return doc ? toEvent(doc) : null;
}

/**
 * Group a ride into a session (DECISIONS #32). A session with no ride yet takes it as its matched
 * ride and is done; otherwise it joins the extras.
 */
export async function addRideToEvent(c: Collections, userId: string, id: string, activityId: string, now: Date) {
  const _id = oid(id);
  if (!_id) return null;
  const current = await c.calendarEvents.findOne({ _id, userId });
  if (!current) return null;
  const update = current.activityId
    ? { $set: { updatedAt: now }, $addToSet: { extraActivityIds: activityId } }
    : { $set: { activityId, status: 'done' as const, updatedAt: now }, $pull: { ignoredActivityIds: activityId } };
  const doc = await c.calendarEvents.findOneAndUpdate({ _id, userId }, update, { returnDocument: 'after' });
  return doc ? toEvent(doc) : null;
}

/**
 * Take one ride out of a session. A grouped ride just leaves (it isn't ignored: the sync may match
 * it to another session that day). The matched ride is remembered as unlinked; the first grouped
 * ride takes its place, or with none left the session goes back to `statusIfEmpty`.
 */
export async function removeRideFromEvent(
  c: Collections,
  userId: string,
  id: string,
  activityId: string,
  statusIfEmpty: 'planned' | 'missed',
  now: Date,
) {
  const _id = oid(id);
  if (!_id) return null;
  const current = await c.calendarEvents.findOne({ _id, userId });
  if (!current) return null;
  const extras = current.extraActivityIds ?? [];
  if (current.activityId !== activityId) {
    if (!extras.includes(activityId)) return null;
    const doc = await c.calendarEvents.findOneAndUpdate(
      { _id, userId },
      { $set: { updatedAt: now }, $pull: { extraActivityIds: activityId } },
      { returnDocument: 'after' },
    );
    return doc ? toEvent(doc) : null;
  }
  if (!extras.length) return unlinkActivity(c, userId, id, statusIfEmpty, now);
  const [next, ...rest] = extras;
  const doc = await c.calendarEvents.findOneAndUpdate(
    { _id, userId },
    {
      $set: { activityId: next!, updatedAt: now, ...(rest.length ? { extraActivityIds: rest } : {}) },
      ...(rest.length ? {} : { $unset: { extraActivityIds: '' as const } }),
      $addToSet: { ignoredActivityIds: activityId },
    },
    { returnDocument: 'after' },
  );
  return doc ? toEvent(doc) : null;
}

/** The session a ride belongs to, matched or grouped. */
export async function findEventByActivity(c: Collections, userId: string, activityId: string) {
  const doc = await c.calendarEvents.findOne({ userId, $or: [{ activityId }, { extraActivityIds: activityId }] });
  return doc ? toEvent(doc) : null;
}

export async function deleteEvent(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.calendarEvents.deleteOne({ _id, userId })).deletedCount === 1;
}

/**
 * Record the intervals.icu side of a session: the link after a push or pull (`intervals`), a push
 * error with no remote event yet (`syncError`), or clear either with `null`.
 */
export async function setEventSync(
  c: Collections,
  userId: string,
  id: string,
  sync: { intervals?: IntervalsLink | null; syncError?: string | null },
  now: Date,
) {
  const _id = oid(id);
  if (!_id) return null;
  const set: Record<string, unknown> = { updatedAt: now };
  const unset: Record<string, ''> = {};
  if (sync.intervals === null) unset['intervals'] = '';
  else if (sync.intervals) set['intervals'] = compact(sync.intervals);
  if (sync.syncError === null) unset['syncError'] = '';
  else if (sync.syncError) set['syncError'] = sync.syncError;
  const doc = await c.calendarEvents.findOneAndUpdate(
    { _id, userId },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: 'after' },
  );
  return doc ? toEvent(doc) : null;
}

export async function findEventByIntervalsId(c: Collections, userId: string, eventId: number) {
  const doc = await c.calendarEvents.findOne({ userId, 'intervals.eventId': eventId });
  return doc ? toEvent(doc) : null;
}

/** Sessions that live on intervals.icu too, plus any waiting for their first push. */
export async function listSyncedEvents(c: Collections, userId: string, from: IsoDate, to: IsoDate) {
  const docs = await c.calendarEvents
    .find({
      userId,
      date: { $gte: from, $lte: to },
      $or: [{ intervals: { $exists: true } }, { kind: { $in: ['workout', 'race'] } }],
    })
    .toArray();
  return docs.map(toEvent);
}

/** Sessions anywhere in time whose push is still owed (link error, or never linked). */
export async function listPendingSync(c: Collections, userId: string) {
  const docs = await c.calendarEvents
    .find({
      userId,
      kind: { $in: ['workout', 'race'] },
      $or: [{ intervals: { $exists: false } }, { 'intervals.error': { $exists: true } }],
    })
    .toArray();
  return docs.map(toEvent);
}
