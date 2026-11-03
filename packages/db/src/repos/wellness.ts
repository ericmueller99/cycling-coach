import type { IsoDate, WellnessDay } from '@cycling-coach/shared';
import type { Collections, WellnessDoc } from '../collections';
import { compact } from './util';

/** intervals.icu wellness per day (DECISIONS #49): CTL/ATL, weigh-ins, steps. Written by the sync only. */

const toDay = (doc: WellnessDoc): WellnessDay => {
  const { _id, userId: _u, syncedAt: _s, ...day } = doc;
  return compact(day) as WellnessDay;
};

/** Replace each day with what intervals.icu has now (a day's weigh-in can be removed there). */
export async function saveWellness(c: Collections, userId: string, days: readonly WellnessDay[], now: Date): Promise<void> {
  if (!days.length) return;
  await c.wellness.bulkWrite(
    days.map((d) => ({
      replaceOne: { filter: { userId, date: d.date }, replacement: { ...compact(d), userId, syncedAt: now } as WellnessDoc, upsert: true },
    })),
    { ordered: false },
  );
}

/** Days in a range (inclusive), oldest first. */
export async function listWellness(c: Collections, userId: string, from: IsoDate, to: IsoDate): Promise<WellnessDay[]> {
  const docs = await c.wellness.find({ userId, date: { $gte: from, $lte: to } }).sort({ date: 1 }).toArray();
  return docs.map(toDay);
}

/** The latest day on or before `date` that has CTL — today's row may not exist yet. */
export async function latestFitnessDay(c: Collections, userId: string, date: IsoDate): Promise<WellnessDay | null> {
  const doc = await c.wellness.findOne({ userId, date: { $lte: date }, ctl: { $exists: true } }, { sort: { date: -1 } });
  return doc ? toDay(doc) : null;
}
