import type { IsoDate, TimeOff, TimeOffInput, TimeOffPatch } from '@cycling-coach/shared';
import type { Filter, UpdateFilter } from 'mongodb';
import type { Collections, TimeOffDoc } from '../collections';
import { compact, idOf, oid } from './util';

const toTimeOff = (doc: TimeOffDoc): TimeOff => {
  const { _id, userId: _u, createdAt: _c, updatedAt: _t, ...rest } = doc;
  return compact({ ...rest, id: idOf(doc) });
};

/** An entry belongs to a range if any of its days do, so one already under way still shows. */
export function timeOffOverlap(userId: string, from: IsoDate, to: IsoDate): Filter<TimeOffDoc> {
  return { userId, startDate: { $lte: to }, endDate: { $gte: from } };
}

export async function listTimeOff(c: Collections, userId: string, from: IsoDate, to: IsoDate): Promise<TimeOff[]> {
  const docs = await c.timeOff.find(timeOffOverlap(userId, from, to)).sort({ startDate: 1, createdAt: 1 }).toArray();
  return docs.map(toTimeOff);
}

export async function getTimeOff(c: Collections, userId: string, id: string): Promise<TimeOff | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.timeOff.findOne({ _id, userId });
  return doc ? toTimeOff(doc) : null;
}

export async function createTimeOff(
  c: Collections,
  userId: string,
  input: TimeOffInput,
  meta: { source: 'coach' | 'manual'; proposalId?: string | undefined },
  now: Date,
): Promise<TimeOff> {
  const doc: TimeOffDoc = compact({ ...input, userId, source: meta.source, proposalId: meta.proposalId, createdAt: now, updatedAt: now });
  const res = await c.timeOff.insertOne(doc);
  return toTimeOff({ ...doc, _id: res.insertedId });
}

/** The Mongo update for a patch: `$set` what it sets, `$unset` what it clears (a set value wins). */
export function timeOffPatchUpdate(patch: TimeOffPatch, now: Date): UpdateFilter<TimeOffDoc> {
  const { unset, ...fields } = patch;
  const set = { ...compact(fields), updatedAt: now };
  return unset?.includes('note') && !('note' in set) ? { $set: set, $unset: { note: '' } } : { $set: set };
}

export async function patchTimeOff(c: Collections, userId: string, id: string, patch: TimeOffPatch, now: Date): Promise<TimeOff | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.timeOff.findOneAndUpdate({ _id, userId }, timeOffPatchUpdate(patch, now), { returnDocument: 'after' });
  return doc ? toTimeOff(doc) : null;
}

export async function deleteTimeOff(c: Collections, userId: string, id: string): Promise<boolean> {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.timeOff.deleteOne({ _id, userId })).deletedCount === 1;
}
