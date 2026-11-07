import { activityFingerprint } from '@cycling-coach/core';
import type { Activity, ActivityInterval, IsoDate, PowerPoint } from '@cycling-coach/shared';
import type { ActivityDoc, Collections } from '../collections';
import { compact } from './util';

/**
 * Rides (DECISIONS #49): written by the intervals.icu sync and, for a deployment's own ride source,
 * by `Core.rides` (#71). Screens and the coach read them here.
 */

/** Only intervals.icu's rides: the sync must never compare, fetch or delete another source's. */
const FROM_INTERVALS = { provider: { $exists: false } } as const;

const toActivity = (doc: ActivityDoc): Activity => {
  const { _id, userId: _u, fingerprint: _f, intervals: _i, detailAt: _d, powerCurve: _p, syncedAt: _s, ...activity } = doc;
  return compact(activity) as Activity;
};

/** `startLocal` bounds for local dates, inclusive. */
const range = (from: IsoDate, to: IsoDate) => ({ $gte: from, $lte: `${to}T23:59:59` });

/** Rides between two local dates, newest first (as intervals.icu lists them). */
export async function listActivities(c: Collections, userId: string, from: IsoDate, to: IsoDate): Promise<Activity[]> {
  const docs = await c.activities.find({ userId, startLocal: range(from, to) }).sort({ startLocal: -1 }).toArray();
  return docs.map(toActivity);
}

/** Ids and fingerprints of the stored rides in a window — what a sync compares against. */
export async function storedRideRefs(c: Collections, userId: string, from: IsoDate, to: IsoDate): Promise<{ id: string; fingerprint: string }[]> {
  return c.activities
    .find({ userId, ...FROM_INTERVALS, startLocal: range(from, to) }, { projection: { _id: 0, id: 1, fingerprint: 1 } })
    .toArray() as Promise<{ id: string; fingerprint: string }[]>;
}

/**
 * Write new and changed rides. A changed ride is replaced whole, which drops its stored intervals
 * and power curve: they described the old version, and the sync fetches them again.
 */
export async function saveActivities(c: Collections, userId: string, activities: readonly Activity[], now: Date): Promise<void> {
  if (!activities.length) return;
  await c.activities.bulkWrite(
    activities.map((a) => ({
      replaceOne: {
        filter: { userId, id: a.id },
        replacement: { ...compact(a), userId, fingerprint: activityFingerprint(a), syncedAt: now } as ActivityDoc,
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function deleteActivities(c: Collections, userId: string, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  return (await c.activities.deleteMany({ userId, id: { $in: [...ids] } })).deletedCount;
}

export interface StoredActivity {
  activity: Activity;
  intervals?: ActivityInterval[] | undefined;
  /** False until the sync has fetched the ride's detected intervals. */
  hasDetail: boolean;
  powerCurve?: PowerPoint[] | undefined;
}

export async function getStoredActivity(c: Collections, userId: string, id: string): Promise<StoredActivity | null> {
  const doc = await c.activities.findOne({ userId, id });
  if (!doc) return null;
  return { activity: toActivity(doc), intervals: doc.intervals, hasDetail: !!doc.detailAt, powerCurve: doc.powerCurve };
}

/**
 * Store a ride's detected intervals, with the summary intervals.icu sent alongside (it may be
 * newer than the listing's). Skipped if the ride was deleted meanwhile.
 */
export async function saveActivityDetail(c: Collections, userId: string, activity: Activity, intervals: readonly ActivityInterval[], now: Date): Promise<void> {
  await c.activities.updateOne(
    { userId, id: activity.id },
    { $set: { ...compact(activity), fingerprint: activityFingerprint(activity), intervals: [...intervals], detailAt: now, syncedAt: now } },
  );
}

/** A ride intervals.icu no longer shares has no detail to fetch: stop asking, and keep it (DECISIONS #71). */
export async function markDetailUnavailable(c: Collections, userId: string, id: string, now: Date): Promise<void> {
  await c.activities.updateOne({ userId, id }, { $set: { detailAt: now } });
}

export async function saveActivityCurve(c: Collections, userId: string, id: string, powerCurve: readonly PowerPoint[]): Promise<void> {
  await c.activities.updateOne({ userId, id }, { $set: { powerCurve: [...powerCurve] } });
}

/** Rides still waiting for their detected intervals, newest first. */
export async function ridesNeedingDetail(c: Collections, userId: string, limit: number): Promise<string[]> {
  const docs = await c.activities
    .find({ userId, ...FROM_INTERVALS, detailAt: { $exists: false } }, { projection: { _id: 0, id: 1 } })
    .sort({ startLocal: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => d.id);
}

export async function countActivities(c: Collections, userId: string, opts: { needingDetail?: boolean } = {}): Promise<number> {
  return c.activities.countDocuments({ userId, ...FROM_INTERVALS, ...(opts.needingDetail ? { detailAt: { $exists: false } } : {}) });
}

/** Whether this athlete has any ride stored, from any source but these. */
export async function hasRides(c: Collections, userId: string, except: readonly string[] = []): Promise<boolean> {
  return (await c.activities.findOne({ userId, ...(except.length ? { provider: { $nin: [...except] } } : {}) }, { projection: { _id: 1 } })) !== null;
}

/** The ids of one source's rides. */
export async function rideIdsFrom(c: Collections, userId: string, provider: string): Promise<string[]> {
  return (await c.activities.find({ userId, provider }, { projection: { _id: 0, id: 1 } }).toArray()).map((a) => a.id);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The coach's `search_activities`: by tag when the query starts with `#`, else name or description,
 * case-insensitive. Newest first, at most 25.
 */
export async function searchActivities(c: Collections, userId: string, query: string): Promise<Activity[]> {
  const q = query.trim();
  if (!q) return [];
  const filter = q.startsWith('#')
    ? { userId, tags: { $regex: `^${escapeRegex(q.slice(1))}$`, $options: 'i' } }
    : { userId, $or: [{ name: { $regex: escapeRegex(q), $options: 'i' } }, { description: { $regex: escapeRegex(q), $options: 'i' } }] };
  const docs = await c.activities.find(filter).sort({ startLocal: -1 }).limit(25).toArray();
  return docs.map(toActivity);
}
