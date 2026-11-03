import { addDays, trendSeries, TREND_DAYS } from '@cycling-coach/core';
import type { IsoDate, WeightHistoryPayload } from '@cycling-coach/shared';
import type { TrainingData } from './training-data';

/** The longest range the Athlete chart shows; shorter ranges are sliced client-side. */
const HISTORY_DAYS = 90;

/**
 * Weigh-ins with the trend as of each day, from the synced wellness (DECISIONS #49). The extra
 * lead-in days give the first points in range a full 7-day window.
 */
export async function weightHistory(training: Pick<TrainingData, 'weighIns'>, userId: string, today: IsoDate): Promise<WeightHistoryPayload> {
  const from = addDays(today, -(HISTORY_DAYS - 1));
  const weighIns = await training.weighIns(userId, addDays(from, -(TREND_DAYS - 1)), today);
  return { points: trendSeries(weighIns).filter((p) => p.date >= from) };
}
