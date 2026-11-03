import type { BodyScan, BodyScanInput, BodyScanPatch, EnergyPatch, EnergySettings } from '@cycling-coach/shared';
import type { BodyScanDoc, Collections } from '../collections';
import { compact, idOf, oid } from './util';

/** BMR and body scans (Athlete page). Kept apart from the full-replace profile document. */

export async function getEnergySettings(c: Collections, userId: string): Promise<EnergySettings> {
  const doc = await c.energySettings.findOne({ userId });
  if (!doc) return {};
  const { _id, userId: _u, updatedAt, ...rest } = doc;
  return compact({ ...rest, updatedAt: updatedAt.toISOString() });
}

export async function patchEnergySettings(c: Collections, userId: string, patch: EnergyPatch, now: Date): Promise<EnergySettings> {
  const { unset = [], ...fields } = patch;
  await c.energySettings.updateOne(
    { userId },
    {
      $set: { ...compact(fields), updatedAt: now },
      ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ''])) } : {}),
      $setOnInsert: { userId },
    },
    { upsert: true },
  );
  return getEnergySettings(c, userId);
}

const toScan = (doc: BodyScanDoc): BodyScan => {
  const { _id, userId: _u, createdAt, ...rest } = doc;
  return compact({ ...rest, id: idOf(doc), createdAt: createdAt.toISOString() });
};

export async function listBodyScans(c: Collections, userId: string): Promise<BodyScan[]> {
  return (await c.bodyScans.find({ userId }).sort({ date: -1, createdAt: -1 }).toArray()).map(toScan);
}

export async function createBodyScan(c: Collections, userId: string, input: BodyScanInput, now: Date): Promise<BodyScan> {
  const doc: BodyScanDoc = { ...compact(input), userId, createdAt: now } as BodyScanDoc;
  const res = await c.bodyScans.insertOne(doc);
  return toScan({ ...doc, _id: res.insertedId });
}

export async function updateBodyScan(c: Collections, userId: string, id: string, patch: BodyScanPatch): Promise<BodyScan | null> {
  const _id = oid(id);
  if (!_id) return null;
  const { unset = [], ...fields } = patch;
  const doc = await c.bodyScans.findOneAndUpdate(
    { _id, userId },
    { $set: compact(fields), ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ''])) } : {}) },
    { returnDocument: 'after' },
  );
  return doc ? toScan(doc) : null;
}

export async function deleteBodyScan(c: Collections, userId: string, id: string): Promise<boolean> {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.bodyScans.deleteOne({ _id, userId })).deletedCount === 1;
}
