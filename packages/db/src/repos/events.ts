import type { EventFilters, SavedSearch, ZwiftEvent } from '@cycling-coach/shared';
import type { Collections, SyncStateDoc, ZwiftEventDoc } from '../collections';
import { compact, idOf, oid } from './util';

/** Zwift events and the route table (DECISIONS #29). Events are shared; marks are per user. */

/**
 * `public`: the public feed has no login, so it carries no sign-up counts — an event the logged-in
 * feed already stored keeps that richer copy (it's refreshed by the next "Get more events").
 */
export async function upsertZwiftEvents(
  c: Collections,
  events: { event: ZwiftEvent; expiresAt: Date }[],
  now: Date,
  opts: { public?: boolean } = {},
) {
  let rows = events;
  if (opts.public && rows.length) {
    const richer = new Set(
      (await c.zwiftEvents.find({ id: { $in: rows.map((r) => r.event.id) }, seenVia: 'extended' }, { projection: { id: 1 } }).toArray()).map((d) => d.id),
    );
    rows = rows.filter((r) => !richer.has(r.event.id));
  }
  if (!rows.length) return;
  await c.zwiftEvents.bulkWrite(
    rows.map(({ event, expiresAt }) => ({
      updateOne: {
        filter: { id: event.id },
        update: { $set: { ...(compact(event) as ZwiftEvent), syncedAt: now, expiresAt } },
        upsert: true,
      },
    })),
    // Nested optional fields (a pen's km) must be left out, not stored as null.
    { ordered: false, ignoreUndefined: true },
  );
}

/**
 * Events in a window the feed just covered completely but didn't return any more — cancelled or
 * made private. `seenVia` keeps the public sync from deleting what only the logged-in feed shows.
 */
export async function removeMissingZwiftEvents(
  c: Collections,
  window: { from: string; to: string },
  seenIds: number[],
  seenVia?: ZwiftEvent['seenVia'],
): Promise<number> {
  const res = await c.zwiftEvents.deleteMany({
    start: { $gte: window.from, $lte: window.to },
    id: { $nin: seenIds },
    ...(seenVia ? { seenVia } : {}),
  });
  return res.deletedCount;
}

/** Drops nulls too: an optional field stored before `ignoreUndefined` reads back as null. */
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

const toZwiftEvent = ({ _id, syncedAt: _s, expiresAt: _e, ...event }: ZwiftEventDoc): ZwiftEvent =>
  ({ ...clean(event), pens: event.pens.map(clean) }) as ZwiftEvent;

/** Every stored event starting after `since` (ISO), by start. A week is ~4,000 documents. */
export async function listZwiftEvents(c: Collections, since: string): Promise<ZwiftEvent[]> {
  const docs = await c.zwiftEvents.find({ start: { $gte: since } }, { projection: { _id: 0, syncedAt: 0, expiresAt: 0 } }).sort({ start: 1 }).toArray();
  return docs.map(toZwiftEvent);
}

export async function getZwiftEvent(c: Collections, id: number): Promise<ZwiftEvent | null> {
  const doc = await c.zwiftEvents.findOne({ id });
  return doc ? toZwiftEvent(doc) : null;
}

export async function zwiftEventsSummary(c: Collections, since: string) {
  const [count, last, lastExtended] = await Promise.all([
    c.zwiftEvents.countDocuments({ start: { $gte: since } }),
    c.zwiftEvents.find({ start: { $gte: since } }, { projection: { start: 1 } }).sort({ start: -1 }).limit(1).next(),
    c.zwiftEvents.find({ seenVia: 'extended', start: { $gte: since } }, { projection: { start: 1 } }).sort({ start: -1 }).limit(1).next(),
  ]);
  return { count, through: last?.start, extendedThrough: lastExtended?.start };
}

/** Sign-ups from the logged-in feed for the events it returned; events with none lose their mark. */
export async function saveZwiftEventMarks(
  c: Collections,
  userId: string,
  marks: { eventId: number; signedUpPenIds: number[]; expiresAt: Date }[],
) {
  const signed = marks.filter((m) => m.signedUpPenIds.length);
  const cleared = marks.filter((m) => !m.signedUpPenIds.length).map((m) => m.eventId);
  if (signed.length) {
    await c.zwiftEventMarks.bulkWrite(
      signed.map((m) => ({
        updateOne: {
          filter: { userId, eventId: m.eventId },
          update: { $set: { userId, eventId: m.eventId, signedUpPenIds: m.signedUpPenIds, expiresAt: m.expiresAt } },
          upsert: true,
        },
      })),
      // Nested optional fields (a pen's km) must be left out, not stored as null.
    { ordered: false, ignoreUndefined: true },
    );
  }
  if (cleared.length) await c.zwiftEventMarks.deleteMany({ userId, eventId: { $in: cleared } });
}

export async function listZwiftEventMarks(c: Collections, userId: string): Promise<Map<number, number[]>> {
  const docs = await c.zwiftEventMarks.find({ userId }).toArray();
  return new Map(docs.map((d) => [d.eventId, d.signedUpPenIds]));
}

/** Zwift event id → the calendar session made from it, for sessions from `fromDate` on. */
export async function zwiftCalendarLinks(c: Collections, userId: string, fromDate: string): Promise<Map<number, string>> {
  const docs = await c.calendarEvents
    .find({ userId, zwiftEventId: { $exists: true }, date: { $gte: fromDate } }, { projection: { zwiftEventId: 1 } })
    .toArray();
  return new Map(docs.flatMap((d) => (d.zwiftEventId !== undefined ? [[d.zwiftEventId, idOf(d)] as const] : [])));
}

export interface StoredRoute {
  id: number;
  name: string;
  world?: string | undefined;
  distanceM: number;
  ascentM: number;
  leadinM: number;
  leadinAscentM: number;
}

export async function saveZwiftRoutes(c: Collections, routes: StoredRoute[], now: Date) {
  if (!routes.length) return;
  await c.zwiftRoutes.bulkWrite(
    routes.map(({ id, ...r }) => ({
      updateOne: { filter: { routeId: id }, update: { $set: { ...compact(r), routeId: id, syncedAt: now } }, upsert: true },
    })),
    // Nested optional fields (a pen's km) must be left out, not stored as null.
    { ordered: false, ignoreUndefined: true },
  );
}

export async function listZwiftRoutes(c: Collections): Promise<StoredRoute[]> {
  const docs = await c.zwiftRoutes.find({}).toArray();
  return docs.map(({ _id, routeId, syncedAt: _s, ...r }) => compact({ ...r, id: routeId }));
}

export async function getSyncState(c: Collections): Promise<SyncStateDoc | null> {
  return c.syncState.findOne({ _id: 'zwift_events' });
}

export async function patchSyncState(
  c: Collections,
  set: Partial<Omit<SyncStateDoc, '_id' | 'updatedAt'>>,
  unset: (keyof SyncStateDoc)[],
  now: Date,
) {
  await c.syncState.updateOne(
    { _id: 'zwift_events' },
    {
      $set: { ...compact(set), updatedAt: now },
      ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ''])) } : {}),
    },
    { upsert: true },
  );
}

export async function listEventSearches(c: Collections, userId: string): Promise<SavedSearch[]> {
  const docs = await c.eventSearches.find({ userId }).sort({ createdAt: 1 }).toArray();
  return docs.map((d) => ({ id: idOf(d), name: d.name, filters: d.filters }));
}

export async function createEventSearch(c: Collections, userId: string, input: { name: string; filters: EventFilters }, now: Date) {
  const doc = { userId, name: input.name, filters: input.filters, createdAt: now };
  const res = await c.eventSearches.insertOne(doc);
  return { id: res.insertedId.toHexString(), name: doc.name, filters: doc.filters } satisfies SavedSearch;
}

export async function deleteEventSearch(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  return _id ? (await c.eventSearches.deleteOne({ _id, userId })).deletedCount === 1 : false;
}
