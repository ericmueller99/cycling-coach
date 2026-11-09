import type { IsoDate, WellnessDay, WellnessScale } from '@cycling-coach/shared';
import { addDays } from './dates';

/**
 * Today's readiness for the coach from intervals.icu wellness (DECISIONS #103): HRV, resting HR and
 * sleep against the athlete's own baseline, and what they entered themselves. Pure: `today` is the
 * athlete's local day, and `days` is roughly the last five weeks, oldest first.
 */

/** How many days back the coach service reads, for the 28-day baseline. */
export const READINESS_DAYS = 35;

/** A baseline needs enough days to mean anything. */
const MIN_FOR_7_DAY = 4;
const MIN_FOR_28_DAY = 14;

type Numeric = 'hrvMs' | 'restingHr' | 'sleepScore';
type Entry = 'sleepQuality' | 'soreness' | 'fatigue' | 'stress' | 'mood' | 'motivation';

/** intervals.icu's words for its 1–4 entries. Lower isn't always better: for motivation 1 is the most. */
const SCALE_WORDS: Record<Entry, Record<WellnessScale, string>> = {
  sleepQuality: { 1: 'great', 2: 'good', 3: 'average', 4: 'poor' },
  soreness: { 1: 'low', 2: 'average', 3: 'high', 4: 'extreme' },
  fatigue: { 1: 'low', 2: 'average', 3: 'high', 4: 'extreme' },
  stress: { 1: 'low', 2: 'average', 3: 'high', 4: 'extreme' },
  mood: { 1: 'great', 2: 'good', 3: 'OK', 4: 'grumpy' },
  motivation: { 1: 'extreme', 2: 'high', 3: 'average', 4: 'low' },
};
const ENTRY_LABEL: Record<Entry, string> = {
  sleepQuality: 'sleep quality',
  soreness: 'soreness',
  fatigue: 'fatigue',
  stress: 'stress',
  mood: 'mood',
  motivation: 'motivation',
};

const mean = (values: readonly number[]) => values.reduce((s, v) => s + v, 0) / values.length;

/** Mean over the `span` days before `today`, leaving today out so a bad night can't soften its own baseline. */
function baseline(days: readonly WellnessDay[], key: Numeric, today: IsoDate, span: number, min: number): number | undefined {
  const from = addDays(today, -span);
  const values = days.filter((d) => d.date >= from && d.date < today).flatMap((d) => d[key] ?? []);
  return values.length >= min ? mean(values) : undefined;
}

/** "(7-day 58, 28-day 60)", or nothing while there's too little history. */
function baselines(days: readonly WellnessDay[], key: Numeric, today: IsoDate): string {
  const week = baseline(days, key, today, 7, MIN_FOR_7_DAY);
  const month = baseline(days, key, today, 28, MIN_FOR_28_DAY);
  const parts = [week === undefined ? '' : `7-day ${Math.round(week)}`, month === undefined ? '' : `28-day ${Math.round(month)}`].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * "Readiness (intervals.icu wellness): HRV 62 ms (7-day 58, 28-day 60) · … ." Each value is today's,
 * else yesterday's (sleep and HRV land after the night). Null when neither day has anything: a
 * week-old number says nothing about today.
 */
export function readinessFromWellness(days: readonly WellnessDay[], today: IsoDate): string | null {
  const yesterday = addDays(today, -1);
  const recent = days.filter((d) => d.date === today || d.date === yesterday).sort((a, b) => b.date.localeCompare(a.date));
  const latest = <K extends keyof WellnessDay>(key: K): WellnessDay[K] | undefined => recent.find((d) => d[key] !== undefined)?.[key];

  const hrv = latest('hrvMs');
  const rhr = latest('restingHr');
  const sleepSec = latest('sleepSec');
  const sleepScore = latest('sleepScore');
  const ready = latest('readiness');
  const device = [
    hrv === undefined ? '' : `HRV ${hrv} ms${baselines(days, 'hrvMs', today)}`,
    rhr === undefined ? '' : `resting HR ${rhr}${baselines(days, 'restingHr', today)}`,
    sleepSec === undefined ? '' : `slept ${(sleepSec / 3600).toFixed(1)} h`,
    sleepScore === undefined ? '' : `sleep score ${sleepScore}${baselines(days, 'sleepScore', today)}`,
    ready === undefined ? '' : `readiness score ${ready}`,
  ].filter(Boolean);
  const entries = (Object.keys(SCALE_WORDS) as Entry[]).flatMap((k) => {
    const v = latest(k);
    return v === undefined ? [] : [`${ENTRY_LABEL[k]} ${SCALE_WORDS[k][v]}`];
  });
  if (!device.length && !entries.length) return null;

  const parts = [...device, ...(entries.length ? [`their own entries: ${entries.join(', ')}`] : [])];
  const enough = baseline(days, 'hrvMs', today, 7, MIN_FOR_7_DAY) !== undefined || baseline(days, 'restingHr', today, 7, MIN_FOR_7_DAY) !== undefined;
  const advice = enough
    ? "Weigh this against today's session: HRV clearly below their baseline, resting HR clearly above it, poor sleep or high soreness or fatigue are reasons to ease off or swap to endurance. It's a nudge, not a diagnosis."
    : 'Too few days yet for a personal baseline, so treat these as one reading and lean on how they say they feel.';
  return `Readiness (intervals.icu wellness): ${parts.join(' · ')}. ${advice}`;
}
