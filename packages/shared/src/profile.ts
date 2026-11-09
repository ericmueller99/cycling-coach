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

/** Where the athlete's FTP came from (onboarding asks; DECISIONS #62). */
export const ftpSources = ['zwift', 'ramp', '20min', 'app', 'guess'] as const;
export const ftpSourceSchema = z.enum(ftpSources);
export type FtpSource = z.infer<typeof ftpSourceSchema>;

/** How hard the athlete wants to go: a ceiling for the coach, never a target (DECISIONS #86). */
export const trainingPreferences = ['steady', 'committed', 'all_in'] as const;
export const trainingPreferenceSchema = z.enum(trainingPreferences);
export type TrainingPreference = z.infer<typeof trainingPreferenceSchema>;
export const TRAINING_PREFERENCE_LABEL: Record<TrainingPreference, string> = { steady: 'Steady', committed: 'Committed', all_in: 'All in' };
/** What each one promises, in the wizard and on the Athlete page. */
export const TRAINING_PREFERENCE_BLURB: Record<TrainingPreference, string> = {
  steady: "Training fits around life. Consistency first, with easy weeks when it's busy.",
  committed: 'Training is a priority. Steady progress, and the hard days that takes.',
  all_in: 'A hard push for a block. More load and more fatigue, and your coach says when to back off.',
};

export const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WEEKDAY_LABEL: Record<(typeof weekdays)[number], string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
/** A week most weeks look like. Optional: without one, the athlete tells the coach as they chat. */
export const usualWeekSchema = z.object({
  days: z.array(z.enum(weekdays)).max(7),
  hoursPerWeek: z.number().min(1).max(40).optional(),
});
export type UsualWeek = z.infer<typeof usualWeekSchema>;

export const profileSchema = z.object({
  /**
   * Unset until it's known (DECISIONS #62): a new athlete who doesn't know theirs gets a ramp test
   * first, and the coach prescribes by feel and heart rate until then.
   */
  ftpZwift: z.number().int().min(50).max(700).optional(),
  ftpSource: ftpSourceSchema.optional(),
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
  /** Unset until they pick one, and the coach coaches as it always has (DECISIONS #86). */
  trainingPreference: trainingPreferenceSchema.optional(),
  /** Unset means they tell the coach when they can ride as they chat. */
  usualWeek: usualWeekSchema.optional(),
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

/**
 * The paces a weight goal can take (DECISIONS #96): what calorie-counting apps offer, kept as picked
 * so "1 lb/week" never turns into "0.45 kg/week". A month is 52/12 weeks. Gaining offers the first two.
 */
export const WEIGHT_PACES = {
  lb: { week: [0.5, 1, 1.5, 2], month: [2, 4, 6, 8] },
  kg: { week: [0.25, 0.5, 0.75, 1], month: [1, 2, 3, 4] },
} as const satisfies Record<'kg' | 'lb', Record<'week' | 'month', readonly number[]>>;
export const weightPaceSchema = z
  .object({ amount: z.number().positive(), unit: z.enum(['kg', 'lb']), per: z.enum(['week', 'month']) })
  .refine((p) => (WEIGHT_PACES[p.unit][p.per] as readonly number[]).includes(p.amount), {
    message: 'Pace must be one of: 0.5, 1, 1.5 or 2 lb a week; 2, 4, 6 or 8 lb a month; 0.25, 0.5, 0.75 or 1 kg a week; 1, 2, 3 or 4 kg a month',
  });
export type WeightPace = z.infer<typeof weightPaceSchema>;

/**
 * How much an event goal counts (DECISIONS #100), as the athlete answered "How much weight should the
 * coach give this event?". Main goal is the goal's `primary` flag, so it isn't stored here; a main
 * event goal keeps `important`, which it falls back to if another goal becomes main.
 */
export const eventWeights = ['important', 'in_mind'] as const;
export type EventWeight = (typeof eventWeights)[number];
/** The three answers, main goal included. */
export type EventWeightChoice = 'main' | EventWeight;
export const EVENT_WEIGHT_LABEL: Record<EventWeightChoice, string> = { main: 'Main goal', important: 'Important', in_mind: 'Keep in mind' };
export const EVENT_WEIGHT_BLURB: Record<EventWeightChoice, string> = {
  main: 'Plans build toward it.',
  important: 'Real room for it beside your main goal, more as it gets closer.',
  in_mind: 'Worked in where it fits, without changing your focus.',
};

/** What the athlete wants from an event. Optional; the goal's `detail` is the note beside it. */
export const eventAims = ['finish', 'time', 'compete'] as const;
export type EventAim = (typeof eventAims)[number];
export const EVENT_AIM_LABEL: Record<EventAim, string> = { finish: 'Finish', time: 'Target time', compete: 'Compete' };

/** Goal fields without defaults — see calendar.ts: Zod applies defaults inside .partial(). */
const goalFields = z.object({
  horizon: z.enum(['long', 'short']),
  title: z.string().min(1).max(120),
  detail: z.string().max(500).optional(),
  /** Retired (DECISIONS #86): older goals may still have one, but nothing writes, shows or sends it. */
  targetLabel: z.string().max(40).optional(),
  /** Only an event's date counts (core.goalTakesDate); other goals are open-ended, and a weight goal has a pace (#96). */
  targetDate: isoDateSchema.optional(),
  /** A dated event to get ready for, rather than something to keep improving. */
  event: z.boolean().optional(),
  /** What the goal is measured by; the current value is always computed live (core.goalProgress). */
  measure: goalMeasureSchema.optional(),
  target: z.number().optional(),
  /** A weight goal's pace, which sets the calorie budget (DECISIONS #96). */
  pace: weightPaceSchema.optional(),
  /** The calendar event (a race session) it's for. Its date follows the event's (DECISIONS #100). */
  eventId: z.string().optional(),
  weight: z.enum(eventWeights).optional(),
  aim: z.enum(eventAims).optional(),
  done: z.boolean(),
  /** The one shown as "Main goal" in the coach's right rail. */
  primary: z.boolean(),
});
export const goalInputSchema = goalFields.extend({ done: z.boolean().default(false), primary: z.boolean().default(false) });
export type GoalInput = z.infer<typeof goalInputSchema>;
/** A partial update; `unset` clears optional fields (JSON has no way to send `undefined`). */
export const goalPatchSchema = goalFields.partial().extend({
  unset: z.array(z.enum(['detail', 'targetLabel', 'targetDate', 'event', 'measure', 'target', 'pace', 'eventId', 'weight', 'aim'])).optional(),
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
  /** `current` follows the daily trend weight, so it must stay out of cached prompt text. */
  onTrendWeight?: boolean | undefined;
}

export const goalSchema = goalInputSchema.extend({ id: z.string() });
/** Goals as the API returns them: with live progress when they're measurable. */
export type Goal = z.infer<typeof goalSchema> & { progress?: GoalProgress | undefined };

const memoryFields = z.object({
  text: z.string().min(1).max(500),
  /** The last local day a short-term note matters. A note without one is long-term (DECISIONS #79). */
  until: isoDateSchema,
});
export const memoryInputSchema = memoryFields.partial({ until: true });
export type MemoryInput = z.infer<typeof memoryInputSchema>;
/** A partial update; `unset: ['until']` makes a note long-term (JSON has no way to send `undefined`). */
export const memoryPatchSchema = memoryFields.partial().extend({ unset: z.array(z.enum(['until'])).optional() });
export type MemoryPatch = z.infer<typeof memoryPatchSchema>;
/** Undo for a coach's update: applies only while the note is still what the coach left (`from`). */
export const memoryRevertSchema = z.object({ from: memoryInputSchema, to: memoryInputSchema });
export type MemoryRevert = z.infer<typeof memoryRevertSchema>;
export const memorySchema = memoryInputSchema.extend({
  id: z.string(),
  source: z.enum(['user', 'coach']),
  createdAt: z.string(),
  /** When the athlete last confirmed it; `createdAt` until they do. */
  reviewedAt: z.string().optional(),
});
export type Memory = z.infer<typeof memorySchema>;
/** An update and what it replaced, which is what a chat chip needs to undo it. */
export interface MemoryUpdate {
  memory: Memory;
  previous: Memory;
}
