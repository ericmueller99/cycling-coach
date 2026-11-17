import type { Activity, Bike, BikeInput, BikePatch, LocalDateTime, RideKind } from '@cycling-coach/shared';
import type { UpdateFilter } from 'mongodb';
import type { BikeDoc, Collections } from '../collections';
import { compact, idOf, oid } from './util';

/**
 * Bikes and which ride was on which (DECISIONS #114). Rides stay in `activities`; a bike is joined
 * through `ride_bikes`, which a sync never touches.
 */

const toBike = (doc: BikeDoc): Bike => {
  const { _id, userId: _u, createdAt: _c, updatedAt: _t, ...rest } = doc;
  return compact({ ...rest, id: idOf(doc) }) as Bike;
};

export async function listBikes(c: Collections, userId: string): Promise<Bike[]> {
  const docs = await c.bikes.find({ userId }).sort({ createdAt: 1 }).toArray();
  return docs.map(toBike);
}

export async function getBike(c: Collections, userId: string, id: string): Promise<Bike | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.bikes.findOne({ _id, userId });
  return doc ? toBike(doc) : null;
}

export async function createBike(c: Collections, userId: string, input: BikeInput, now: Date): Promise<Bike> {
  const doc: BikeDoc = { ...compact(input), userId, waxes: [], createdAt: now, updatedAt: now } as BikeDoc;
  const res = await c.bikes.insertOne(doc);
  return toBike({ ...doc, _id: res.insertedId });
}

export function bikePatchUpdate(patch: BikePatch, now: Date): UpdateFilter<BikeDoc> {
  const { unset, ...fields } = patch;
  const set = { ...compact(fields), updatedAt: now };
  const cleared = (unset ?? []).filter((k) => !(k in set));
  return cleared.length ? { $set: set, $unset: Object.fromEntries(cleared.map((k) => [k, ''])) } : { $set: set };
}

export async function patchBike(c: Collections, userId: string, id: string, patch: BikePatch, now: Date): Promise<Bike | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.bikes.findOneAndUpdate({ _id, userId }, bikePatchUpdate(patch, now), { returnDocument: 'after' });
  return doc ? toBike(doc) : null;
}

/** One default per kind: take it from every bike but `keepId`. */
export async function clearBikeDefault(c: Collections, userId: string, kind: RideKind, keepId: string | undefined, now: Date): Promise<void> {
  const keep = keepId ? oid(keepId) : null;
  await c.bikes.updateMany({ userId, defaultFor: kind, ...(keep ? { _id: { $ne: keep } } : {}) }, { $unset: { defaultFor: '' }, $set: { updatedAt: now } });
}

/** Its rides become "no bike", so a default never picks them up again. */
export async function deleteBike(c: Collections, userId: string, id: string, now: Date): Promise<boolean> {
  const _id = oid(id);
  if (!_id) return false;
  const gone = (await c.bikes.deleteOne({ _id, userId })).deletedCount === 1;
  if (gone) await c.rideBikes.updateMany({ userId, bikeId: id }, { $set: { bikeId: null, how: 'manual', updatedAt: now } });
  return gone;
}

/** A re-wax: the counter starts again at `at`, and the log keeps how far the chain went. Waxed chains only. */
export async function recordWax(c: Collections, userId: string, id: string, at: LocalDateTime, km: number, now: Date): Promise<Bike | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.bikes.findOneAndUpdate(
    { _id, userId, 'chain.type': 'waxed' },
    { $set: { 'chain.lastWaxedAt': at, updatedAt: now }, $push: { waxes: { at, km } } },
    { returnDocument: 'after' },
  );
  return doc ? toBike(doc) : null;
}

/** The bike on each of these rides that has one (`null` for "no bike"). */
export async function rideBikesFor(c: Collections, userId: string, activityIds: readonly string[]): Promise<Map<string, string | null>> {
  if (!activityIds.length) return new Map();
  const docs = await c.rideBikes.find({ userId, activityId: { $in: [...activityIds] } }).toArray();
  return new Map(docs.map((d) => [d.activityId, d.bikeId]));
}

/** The rider's own choice, which nothing changes after. */
export async function setRideBike(c: Collections, userId: string, activityId: string, bikeId: string | null, now: Date): Promise<void> {
  await c.rideBikes.updateOne({ userId, activityId }, { $set: { bikeId, how: 'manual', updatedAt: now } }, { upsert: true });
}

/** Default bikes for rides that have none yet. A ride that already has a bike (or "no bike") keeps it. */
export async function stampRideBikes(c: Collections, userId: string, stamps: readonly { activityId: string; bikeId: string }[], now: Date): Promise<void> {
  if (!stamps.length) return;
  await c.rideBikes.bulkWrite(
    stamps.map((s) => ({
      updateOne: {
        filter: { userId, activityId: s.activityId },
        update: { $setOnInsert: { userId, activityId: s.activityId, bikeId: s.bikeId, how: 'default' as const, updatedAt: now } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export type RideFacts = Pick<Activity, 'id' | 'type' | 'isTrainer' | 'source' | 'startLocal' | 'distanceM'>;

/** Every stored ride with no `ride_bikes` row, from `from` (a `startLocal` bound) when given. */
export async function ridesWithoutBike(c: Collections, userId: string, from?: string): Promise<RideFacts[]> {
  const assigned = await c.rideBikes.distinct('activityId', { userId });
  return c.activities
    .find(
      { userId, id: { $nin: assigned }, ...(from ? { startLocal: { $gte: from } } : {}) },
      { projection: { _id: 0, id: 1, type: 1, isTrainer: 1, source: 1, startLocal: 1, distanceM: 1 } },
    )
    .toArray() as Promise<RideFacts[]>;
}

/** Every ride that's on a bike, with what wear needs. Rides deleted since are left out by the join. */
export async function bikeRides(c: Collections, userId: string): Promise<{ bikeId: string; distanceM: number; startLocal: string }[]> {
  const links = await c.rideBikes.find({ userId, bikeId: { $ne: null } }, { projection: { _id: 0, activityId: 1, bikeId: 1 } }).toArray();
  if (!links.length) return [];
  const bikeOf = new Map(links.map((l) => [l.activityId, l.bikeId!]));
  const rides = await c.activities
    .find({ userId, id: { $in: [...bikeOf.keys()] } }, { projection: { _id: 0, id: 1, distanceM: 1, startLocal: 1 } })
    .toArray();
  return rides.map((r) => ({ bikeId: bikeOf.get(r.id)!, distanceM: r.distanceM, startLocal: r.startLocal }));
}

/**
 * A ride replaced by its twin (DECISIONS #71, #91): its bike moves too, unless the rider already set
 * one on the twin.
 */
export async function moveRideBike(c: Collections, userId: string, id: string, twinId: string, now: Date): Promise<void> {
  const old = await c.rideBikes.findOne({ userId, activityId: id });
  if (!old) return;
  const twin = await c.rideBikes.findOne({ userId, activityId: twinId });
  if (!twin || (twin.how === 'default' && old.how === 'manual')) {
    await c.rideBikes.updateOne({ userId, activityId: twinId }, { $set: { bikeId: old.bikeId, how: old.how, updatedAt: now } }, { upsert: true });
  }
  await c.rideBikes.deleteOne({ _id: old._id! });
}

export async function removeRideBikes(c: Collections, userId: string, activityIds: readonly string[]): Promise<void> {
  if (activityIds.length) await c.rideBikes.deleteMany({ userId, activityId: { $in: [...activityIds] } });
}

