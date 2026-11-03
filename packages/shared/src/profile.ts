import { z } from 'zod';
import { isoDateSchema } from './common';

export const zwiftCategories = ['A+', 'A', 'B', 'C', 'D', 'E'] as const;
export type ZwiftCategory = (typeof zwiftCategories)[number];

/**
 * Zwift's own race metrics (DECISIONS #23): synced from Zwift, or typed in when the sync is off.
 * zFTP/zMAP set the category Zwift Racing League uses; Racing Score is results-based, context only.
 */
export const zwiftMetricsSchema = z.object({
  zftp: z.number().int().min(50).max(700).optional(),
  zmap: z.number().int().min(50).max(1500).optional(),
  /** Zwift's zFTP/zMAP category — not the Racing Score band. */
  category: z.enum(zwiftCategories).optional(),
  racingScore: z.number().min(0).max(1000).optional(),
  /** When Zwift last computed them, or the day they were typed in. */
  asOf: isoDateSchema,
  source: z.enum(['zwift', 'manual']),
});
export type ZwiftMetrics = z.infer<typeof zwiftMetricsSchema>;

export const profileSchema = z.object({
  ftpZwift: z.number().int().min(50).max(700),
  /**
   * Coaching weight. When synced, the TREND weight — the median of the last 7 days of weigh-ins
   * from intervals.icu — so a one-off swing doesn't move it (core.trendWeight).
   */
  weightKg: z.number().min(30).max(200),
  weightSource: z.enum(['intervals.icu', 'manual']).default('manual'),
  /** The most recent weigh-in, for display. */
  weightLatest: z.object({ kg: z.number(), date: isoDateSchema }).optional(),
  /** The weight the athlete sets in Zwift (race categories). Falls back to the trend weight. */
  zwiftWeightKg: z.number().min(30).max(200).optional(),
  heightCm: z.number().min(100).max(230).optional(),
  zwiftId: z.string().max(40).optional(),
  zwift: zwiftMetricsSchema.optional(),
  /** IANA zone. "Today" for the coach and the calendar is the athlete's local day. */
  timezone: z.string().min(1).default('UTC'),
});
export type Profile = z.infer<typeof profileSchema>;

/** The rows on the Profile screen, in order. */
export const powerBestDurations = [5, 15, 30, 60, 120, 180, 300, 480, 720, 1200, 3600] as const;
export const powerBestPeriods = ['90d', 'season', 'allTime'] as const;

export const powerBestSchema = z.object({
  period: z.enum(powerBestPeriods),
  durationSec: z.number().int().positive(),
  watts: z.number().int().min(0).max(3000).optional(),
  date: isoDateSchema.optional(),
  /** "intervals.icu" when synced from the power curve, otherwise free text ("Outdoor, all-out"). */
  source: z.string().max(160).optional(),
  /** intervals.icu activity the best came from, when synced. */
  activityId: z.string().optional(),
});
export type PowerBest = z.infer<typeof powerBestSchema>;

/**
 * A goal's live measure. Nothing here stores a current value except `manual`, which is for
 * things the app can't see.
 */
export const goalMeasureSchema = z.discriminatedUnion('kind', [
  /** FTP ÷ weight, on the Zwift baseline or the trend weight. */
  z.object({ kind: z.literal('wkg'), weight: z.enum(['zwift', 'trend']) }),
  z.object({ kind: z.literal('ftp') }),
  /** zFTP or zMAP ÷ Zwift weight — what Zwift Racing League categories use. */
  z.object({ kind: z.literal('zwift_wkg'), metric: z.enum(['zftp', 'zmap']) }),
  /** A synced power best, e.g. 5-min over 90 days. */
  z.object({ kind: z.literal('power_best'), durationSec: z.number().int().positive(), period: z.enum(['90d', 'season', 'allTime']) }),
  /** Trend weight; lower is progress. */
  z.object({ kind: z.literal('weight') }),
  /** CTL from intervals.icu. */
  z.object({ kind: z.literal('fitness') }),
  z.object({ kind: z.literal('manual'), current: z.number(), unit: z.string().max(12) }),
]);
export type GoalMeasure = z.infer<typeof goalMeasureSchema>;

/** Goal fields without defaults — see calendar.ts: Zod applies defaults inside .partial(). */
const goalFields = z.object({
  horizon: z.enum(['long', 'short']),
  title: z.string().min(1).max(120),
  detail: z.string().max(500).optional(),
  /** Free-text horizon label as shown on the card, e.g. "This winter", "Sept 2027". */
  targetLabel: z.string().max(40).optional(),
  targetDate: isoDateSchema.optional(),
  /** What the goal is measured by; the current value is always computed live (core.goalProgress). */
  measure: goalMeasureSchema.optional(),
  target: z.number().optional(),
  done: z.boolean(),
  /** The one shown as "Main goal" in the coach's right rail. */
  primary: z.boolean(),
});
export const goalInputSchema = goalFields.extend({ done: z.boolean().default(false), primary: z.boolean().default(false) });
export type GoalInput = z.infer<typeof goalInputSchema>;
/** A partial update; `unset` clears optional fields (JSON has no way to send `undefined`). */
export const goalPatchSchema = goalFields.partial().extend({
  unset: z.array(z.enum(['detail', 'targetLabel', 'targetDate', 'measure', 'target'])).optional(),
});
export type GoalPatch = z.infer<typeof goalPatchSchema>;
export interface GoalProgress {
  current: number;
  target: number;
  unit: string;
  /** 0–1, already direction-aware (weight counts down). */
  fraction: number;
  /** e.g. "W/kg (Zwift weight)" */
  label: string;
}

export const goalSchema = goalInputSchema.extend({ id: z.string() });
/** Goals as the API returns them: with live progress when they're measurable. */
export type Goal = z.infer<typeof goalSchema> & { progress?: GoalProgress | undefined };

export const memoryInputSchema = z.object({ text: z.string().min(1).max(500) });
export const memorySchema = memoryInputSchema.extend({
  id: z.string(),
  source: z.enum(['user', 'coach']),
  createdAt: z.string(),
});
export type Memory = z.infer<typeof memorySchema>;
