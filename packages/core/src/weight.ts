import type { IsoDate } from '@cycling-coach/shared';
import { addDays, daysBetween } from './dates';

export interface WeighIn {
  date: IsoDate;
  kg: number;
}

export const TREND_DAYS = 7;
const MIN_FOR_MEDIAN = 3;

/**
 * Coaching weight: the median of weigh-ins in the 7 days up to the latest one. A median, not a
 * mean, so one post-pizza reading doesn't move it at all. With fewer than 3 weigh-ins in the window
 * there's no meaningful median, so the latest stands.
 */
export function trendWeight(weighIns: readonly WeighIn[]): { trendKg: number; latest: WeighIn } | null {
  const valid = weighIns.filter((w) => w.kg > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = valid[valid.length - 1];
  if (!latest) return null;
  const window = valid.filter((w) => daysBetween(w.date, latest.date) < TREND_DAYS).map((w) => w.kg);
  if (window.length < MIN_FOR_MEDIAN) return { trendKg: latest.kg, latest };
  const sorted = [...window].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { trendKg: Math.round(median * 10) / 10, latest };
}

/**
 * Each weigh-in with the trend weight as of that day — `trendWeight` over the weigh-ins up to it —
 * so a chart's trend line ends on exactly the coaching weight. Oldest first.
 */
export function trendSeries(weighIns: readonly WeighIn[]): (WeighIn & { trendKg: number })[] {
  const valid = weighIns.filter((w) => w.kg > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  return valid.map((w, i) => ({ ...w, trendKg: trendWeight(valid.slice(0, i + 1))!.trendKg }));
}

/**
 * How much the trend moved over the last `days`: the latest trend minus the trend on the last
 * weigh-in at least `days` earlier (or the first one, when the history is shorter).
 */
export function trendChange(points: readonly { date: IsoDate; trendKg: number }[], days: number): number | undefined {
  const last = points[points.length - 1];
  if (!last || points.length < 2) return undefined;
  const start = points.filter((p) => daysBetween(p.date, last.date) >= days).pop() ?? points[0]!;
  return Math.round((last.trendKg - start.trendKg) * 10) / 10;
}

/** How far the Zwift baseline may sit from the trend before it's worth updating in Zwift. */
export const ZWIFT_WEIGHT_TOLERANCE_KG = 2;

/**
 * Zwift baseline minus trend, when it's off by more than the tolerance; otherwise null. No Zwift
 * weight set means the trend is used anyway, so there's nothing to drift.
 */
export function zwiftWeightDrift(zwiftKg: number | undefined, trendKg: number): number | null {
  if (zwiftKg === undefined) return null;
  const drift = Math.round((zwiftKg - trendKg) * 10) / 10;
  return Math.abs(drift) > ZWIFT_WEIGHT_TOLERANCE_KG ? drift : null;
}

/** How stale a weigh-in may be and still give a week its trend weight. */
const WEEK_TREND_MAX_AGE_DAYS = 10;

/**
 * The trend weight at the end of each Monday-start week (the calendar's week column): the last trend
 * point on or before the week's Sunday — or today, for the current week. Weeks that haven't started,
 * or with no weigh-in in the 10 days before their end, get null.
 */
export function weekTrends(points: readonly { date: IsoDate; trendKg: number }[], weekStarts: readonly IsoDate[], today: IsoDate): { start: IsoDate; trendKg: number | null }[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  return weekStarts.map((start) => {
    if (start > today) return { start, trendKg: null };
    const sunday = addDays(start, 6);
    const end = sunday < today ? sunday : today;
    const last = sorted.filter((p) => p.date <= end).pop();
    return { start, trendKg: last && daysBetween(last.date, end) <= WEEK_TREND_MAX_AGE_DAYS ? last.trendKg : null };
  });
}
