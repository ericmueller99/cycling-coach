import { z } from 'zod';
import { isoDateSchema, sessionTypeSchema } from './common';

/**
 * `missed` is set automatically once a planned session's day has passed with no matching ride;
 * `skipped` is the user's own call.
 */
export const eventStatuses = ['planned', 'done', 'skipped', 'missed'] as const;

/**
 * What a session is, independent of how hard it is (`type`, which drives colour):
 * - `workout` — structured, from the library; `platform` says where it's ridden. Syncs to intervals.icu.
 * - `race` — a scheduled race (Zwift for now). Syncs to intervals.icu as a race event.
 * - `ride` — anything else planned (Z2, group ride, eFondo, recovery spin). Stays in this app.
 */
export const sessionKinds = ['workout', 'race', 'ride'] as const;
export const sessionKindSchema = z.enum(sessionKinds);
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const platforms = ['zwift', 'garmin'] as const;
export const platformSchema = z.enum(platforms);
export type Platform = z.infer<typeof platformSchema>;

export const racePriorities = ['A', 'B', 'C'] as const;

/**
 * The fields, without cross-field rules (Zod can't extend a refined object) and WITHOUT defaults:
 * Zod still applies a default inside `.partial()`, so a patch built from defaulted fields would
 * quietly turn `{date}` into `{date, kind: 'ride', …}` — which demoted moved workouts to rides.
 * Defaults belong to creation only (`calendarEventInputSchema`).
 */
const calendarEventFields = z.object({
  date: isoDateSchema,
  kind: sessionKindSchema,
  type: sessionTypeSchema,
  title: z.string().min(1).max(120),
  /** Where a workout or race is ridden. Defaults to Zwift for workouts and races. */
  platform: platformSchema.optional(),
  /** Local start time, `HH:mm` — races have one. */
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm')
    .optional(),
  /** Race priority as intervals.icu understands it. */
  priority: z.enum(racePriorities).optional(),
  /** Short secondary line on the chip, e.g. "warm-up 2 × 1 min @ 380 W". */
  meta: z.string().max(160).optional(),
  workoutId: z.string().optional(),
  /** Numeric estimate for the weekly Hours column; ranges use their midpoint. */
  durationMin: z.number().int().min(0).max(24 * 60).optional(),
  /** Human label when the duration is a range, e.g. "2–2.5 h". */
  durationLabel: z.string().max(20).optional(),
  tentative: z.boolean(),
  /** Conditional logic in plain words, e.g. "Only if you didn't race Wednesday". */
  coachNote: z.string().max(1000).optional(),
  /** The Zwift event (and pen) this session came from (Events page). */
  zwiftEventId: z.number().int().optional(),
  zwiftPenId: z.number().int().optional(),
});

export const calendarEventInputSchema = calendarEventFields
  .extend({ kind: sessionKindSchema.default('ride'), tentative: z.boolean().default(false) })
  .superRefine((e, ctx) => {
    if (e.kind === 'workout' && !e.workoutId) {
      ctx.addIssue({ code: 'custom', path: ['workoutId'], message: 'A workout session needs a library workoutId (create_workout first).' });
    }
  });
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

/** The intervals.icu event a session is mirrored to. */
export const intervalsLinkSchema = z.object({
  eventId: z.number().int(),
  /** intervals.icu's own uid for the event (it assigns one; ours travel as `external_id`). */
  uid: z.string().optional(),
  /** intervals.icu's `updated` at our last sync — newer means it was edited there. */
  remoteUpdated: z.string().optional(),
  syncedAt: z.string().optional(),
  /** The last push failed; the next sync retries it, and local changes win until then. */
  error: z.string().optional(),
});
export type IntervalsLink = z.infer<typeof intervalsLinkSchema>;

export const calendarEventSchema = calendarEventFields.extend({
  id: z.string(),
  status: z.enum(eventStatuses),
  source: z.enum(['coach', 'manual', 'intervals']),
  /** The completed intervals.icu activity matched to this session. */
  activityId: z.string().optional(),
  /** Rides unlinked from this session — the sync never matches them to it again. Server-set only. */
  ignoredActivityIds: z.array(z.string()).optional(),
  /**
   * More same-day rides the user grouped into this session (a long ride split across several Zwift
   * activities). `activityId` stays the primary ride. Server-set only, never automatic.
   */
  extraActivityIds: z.array(z.string()).optional(),
  proposalId: z.string().optional(),
  intervals: intervalsLinkSchema.optional(),
  /** Set when a push failed before any intervals.icu event existed. */
  syncError: z.string().optional(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** Optional fields an edit can clear (an empty start time, deleted notes, a stale range label). */
export const clearableEventFields = ['startTime', 'coachNote', 'meta', 'durationMin', 'durationLabel'] as const;
export type ClearableEventField = (typeof clearableEventFields)[number];

export const calendarEventPatchSchema = calendarEventFields.partial().extend({
  status: z.enum(eventStatuses).optional(),
  /** Fields to remove. A field both set and unset keeps the set value. Not offered to the coach. */
  unset: z.array(z.enum(clearableEventFields)).optional(),
});
export type CalendarEventPatch = z.infer<typeof calendarEventPatchSchema>;

export const calendarRangeQuerySchema = z.object({ from: isoDateSchema, to: isoDateSchema });

/** Kinds that live on the intervals.icu calendar too. */
export const syncedKinds: readonly SessionKind[] = ['workout', 'race'];

/** Group a same-day ride into a session (the user's action only). */
export const sessionRideInputSchema = z.object({ activityId: z.string().min(1) });
export type SessionRideInput = z.infer<typeof sessionRideInputSchema>;
