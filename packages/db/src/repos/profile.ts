import type { Goal, GoalInput, GoalPatch, IsoDate, Memory, MemoryPatch, MemoryRevert, PowerBest, Profile, ProfileUpdate } from '@cycling-coach/shared';
import type { Collections, GoalDoc, MemoryDoc } from '../collections';
import { compact, idOf, oid } from './util';

/** The account name (Account page), for the coach and the .zwo author. */
export async function getUserName(c: Collections, userId: string): Promise<string | null> {
  const _id = oid(userId);
  const user = _id ? await c.users.findOne({ _id }, { projection: { name: 1 } }) : null;
  return user?.name || null;
}

/**
 * The self-host owner: the account with this email, or else the oldest account (ObjectIds sort by
 * creation time). The server's env credentials belong to it (DECISIONS #53).
 */
export async function ownerUserId(c: Collections, email?: string): Promise<string | null> {
  const user = email
    ? await c.users.findOne({ email: email.toLowerCase() }, { projection: { _id: 1 } })
    : await c.users.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(1).next();
  return user ? user._id.toHexString() : null;
}

export async function getProfile(c: Collections, userId: string): Promise<Profile | null> {
  const doc = await c.profiles.findOne({ userId });
  if (!doc) return null;
  const { _id, userId: _u, updatedAt: _t, ...profile } = doc;
  return compact(profile);
}

const OPTIONAL_PROFILE_FIELDS = ['ftpZwift', 'ftpSource', 'weightLatest', 'zwiftWeightKg', 'heightCm', 'zwiftId', 'zwift'] as const;

/** Replaces the profile: an optional field left out (e.g. a cleared Zwift weight) is removed. */
export async function saveProfile(c: Collections, userId: string, profile: Profile, now: Date) {
  const set = compact(profile);
  const unset = OPTIONAL_PROFILE_FIELDS.filter((k) => set[k] === undefined);
  await c.profiles.updateOne(
    { userId },
    {
      $set: { ...set, userId, updatedAt: now },
      ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ''])) } : {}),
    },
    { upsert: true },
  );
}

/** Weight from intervals.icu: the trend becomes the coaching weight; the latest is for display. */
export async function setSyncedWeight(
  c: Collections,
  userId: string,
  weight: { trendKg: number; latest: { kg: number; date: string } },
  now: Date,
) {
  await c.profiles.updateOne(
    { userId },
    { $set: { weightKg: weight.trendKg, weightSource: 'intervals.icu', weightLatest: weight.latest, updatedAt: now } },
  );
}

/** From Zwift itself (DECISIONS #23): its metrics, and the weight and FTP actually set there. */
export async function setSyncedZwift(
  c: Collections,
  userId: string,
  sync: Pick<Profile, 'zwift' | 'zwiftWeightKg' | 'ftpZwift' | 'zwiftId'>,
  now: Date,
) {
  await c.profiles.updateOne({ userId }, { $set: { ...compact(sync), updatedAt: now } });
}

export async function listPowerBests(c: Collections, userId: string): Promise<PowerBest[]> {
  const docs = await c.powerBests.find({ userId }).sort({ period: 1, durationSec: 1 }).toArray();
  return docs.map(({ _id, userId: _u, updatedAt: _t, ...pb }) => compact(pb));
}

export async function savePowerBest(c: Collections, userId: string, pb: PowerBest, now: Date) {
  await c.powerBests.updateOne(
    { userId, period: pb.period, durationSec: pb.durationSec },
    { $set: { ...compact(pb), userId, updatedAt: now }, ...(pb.activityId ? {} : { $unset: { activityId: '' } }) },
    { upsert: true },
  );
}

/** Applies a confirmed `propose_profile_update` from the coach. */
export async function applyProfileUpdate(
  c: Collections,
  userId: string,
  update: ProfileUpdate,
  now: Date,
) {
  const fields = compact({
    ftpZwift: update.ftpZwift,
    zwiftWeightKg: update.zwiftWeightKg,
  });
  if (Object.keys(fields).length) {
    await c.profiles.updateOne({ userId }, { $set: { ...fields, updatedAt: now } });
  }
  for (const pb of update.powerBests ?? []) {
    await savePowerBest(c, userId, { ...pb, source: pb.source ?? 'Set by coach' }, now);
  }
}

const toGoal = (doc: GoalDoc): Goal => {
  const { _id, userId: _u, createdAt: _c, ...goal } = doc;
  return compact({ ...goal, id: idOf(doc) });
};

export async function listGoals(c: Collections, userId: string): Promise<Goal[]> {
  return (await c.goals.find({ userId }).sort({ createdAt: 1, _id: 1 }).toArray()).map(toGoal);
}

export async function createGoal(c: Collections, userId: string, input: GoalInput, now: Date) {
  const doc: GoalDoc = { ...compact(input), userId, createdAt: now };
  if (input.primary) await c.goals.updateMany({ userId }, { $set: { primary: false } });
  const res = await c.goals.insertOne(doc);
  return toGoal({ ...doc, _id: res.insertedId });
}

export async function updateGoal(c: Collections, userId: string, id: string, input: GoalPatch) {
  const _id = oid(id);
  if (!_id) return null;
  const { unset = [], ...fields } = input;
  if (fields.primary) await c.goals.updateMany({ userId }, { $set: { primary: false } });
  const doc = await c.goals.findOneAndUpdate(
    { _id, userId },
    {
      $set: compact(fields),
      ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ''])) } : {}),
    },
    { returnDocument: 'after' },
  );
  return doc ? toGoal(doc) : null;
}

export async function deleteGoal(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.goals.deleteOne({ _id, userId })).deletedCount === 1;
}

const toMemory = (doc: MemoryDoc): Memory => ({
  id: idOf(doc),
  text: doc.text,
  source: doc.source,
  createdAt: doc.createdAt.toISOString(),
  ...(doc.until ? { until: doc.until } : {}),
  ...(doc.reviewedAt ? { reviewedAt: doc.reviewedAt.toISOString() } : {}),
});

/** Every note that hasn't been deleted, expired ones included: `core`'s memory helpers sort them out. */
export async function listMemories(c: Collections, userId: string): Promise<Memory[]> {
  const docs = await c.memories
    .find({ userId, deletedAt: { $exists: false } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return docs.map(toMemory);
}

export async function getMemory(c: Collections, userId: string, id: string): Promise<Memory | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.memories.findOne({ _id, userId, deletedAt: { $exists: false } });
  return doc ? toMemory(doc) : null;
}

export async function createMemory(
  c: Collections,
  userId: string,
  text: string,
  source: 'user' | 'coach',
  now: Date,
  until?: IsoDate,
): Promise<Memory> {
  const doc: MemoryDoc = { userId, text, source, createdAt: now, ...(until ? { until } : {}) };
  const res = await c.memories.insertOne(doc);
  return toMemory({ ...doc, _id: res.insertedId });
}

/** Any edit counts as the athlete looking at the note, so it also resets its review date. */
export async function updateMemory(c: Collections, userId: string, id: string, patch: MemoryPatch, now: Date) {
  const _id = oid(id);
  if (!_id) return null;
  const { unset = [], ...fields } = patch;
  // Mongo refuses to $set and $unset the same field.
  const set = compact({ ...fields, ...(unset.includes('until') ? { until: undefined } : {}) });
  const doc = await c.memories.findOneAndUpdate(
    { _id, userId, deletedAt: { $exists: false } },
    { $set: { ...set, reviewedAt: now }, ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ''])) } : {}) },
    { returnDocument: 'after' },
  );
  return doc ? toMemory(doc) : null;
}

/** "Still true": the note stays as it is and its review date starts again. */
export async function reviewMemory(c: Collections, userId: string, id: string, now: Date) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.memories.findOneAndUpdate(
    { _id, userId, deletedAt: { $exists: false } },
    { $set: { reviewedAt: now } },
    { returnDocument: 'after' },
  );
  return doc ? toMemory(doc) : null;
}

/** Puts a note back, but only while it still matches `from`: a later edit is never overwritten. */
export async function revertMemory(c: Collections, userId: string, id: string, { from, to }: MemoryRevert) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.memories.findOneAndUpdate(
    { _id, userId, deletedAt: { $exists: false }, text: from.text, until: from.until ?? { $exists: false } },
    { $set: { text: to.text, ...(to.until ? { until: to.until } : {}) }, ...(to.until ? {} : { $unset: { until: '' } }) },
    { returnDocument: 'after' },
  );
  return doc ? toMemory(doc) : null;
}

/** Soft delete. Returns the memory so the caller can show what was forgotten. */
export async function forgetMemory(c: Collections, userId: string, id: string, now: Date) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.memories.findOneAndUpdate(
    { _id, userId, deletedAt: { $exists: false } },
    { $set: { deletedAt: now } },
    { returnDocument: 'after' },
  );
  return doc ? toMemory(doc) : null;
}

export async function restoreMemory(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.memories.findOneAndUpdate(
    { _id, userId },
    { $unset: { deletedAt: '' } },
    { returnDocument: 'after' },
  );
  return doc ? toMemory(doc) : null;
}
