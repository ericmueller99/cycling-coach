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
 * What a real-world event is (DECISIONS #98). An event is a `race` session ridden outdoors
 * (`platform: 'garmin'`) that carries `eventInfo`; a Zwift race has none.
 */
export const eventTypes = [
  'gran_fondo',
  'sportive',
  'road_race',
  'criterium',
  'time_trial',
  'hill_climb',
  'stage_race',
  'gravel',
  'cyclocross',
  'mtb',
  'ultra',
  'track',
  'triathlon',
  'other',
] as const;
export const eventTypeSchema = z.enum(eventTypes);
export type EventType = z.infer<typeof eventTypeSchema>;

/** The picker's words, in the picker's order. */
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  gran_fondo: 'Gran fondo / medio fondo',
  sportive: 'Sportive / century / charity ride',
  road_race: 'Road race',
  criterium: 'Criterium',
  time_trial: 'Time trial',
  hill_climb: 'Hill climb',
  stage_race: 'Stage race / multi-day tour',
  gravel: 'Gravel race',
  cyclocross: 'Cyclocross',
  mtb: 'Mountain bike (XC / marathon)',
  ultra: 'Ultra / brevet / bikepacking',
  track: 'Track',
  triathlon: 'Triathlon / duathlon (bike leg)',
  other: 'Other',
};

/** Tags, chips and the coach's calendar lines. */
export const EVENT_TYPE_SHORT: Record<EventType, string> = {
  gran_fondo: 'Gran fondo',
  sportive: 'Sportive',
  road_race: 'Road race',
  criterium: 'Crit',
  time_trial: 'Time trial',
  hill_climb: 'Hill climb',
  stage_race: 'Stage race',
  gravel: 'Gravel',
  cyclocross: 'Cyclocross',
  mtb: 'MTB',
  ultra: 'Ultra',
  track: 'Track',
  triathlon: 'Triathlon',
  other: 'Event',
};

/** A real-world event's details. A patch replaces the whole object. */
export const eventInfoSchema = z.object({
  type: eventTypeSchema,
  distanceKm: z.number().min(0).max(2000).optional(),
  ascentM: z.number().int().min(0).max(30000).optional(),
  location: z.string().max(120).optional(),
  url: z.string().max(300).optional(),
});
export type EventInfo = z.infer<typeof eventInfoSchema>;

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
  /**
   * The Zwift route a race follows, by Zwift's own id (GameDictionary `signature`, a pen's `routeId`),
   * and how many laps (DECISIONS #102). Only accounts with the Zwift feature see or read them, and the
   * coach's tools never offer them.
   */
  zwiftRouteId: z.number().int().optional(),
  zwiftLaps: z.number().int().min(1).max(50).optional(),
  /** A real-world event's details (DECISIONS #98). Races only. */
  eventInfo: eventInfoSchema.optional(),
});

/** Creation adds the defaults and the cross-field rules. */
const creationDefaults = { kind: sessionKindSchema.default('ride'), tentative: z.boolean().default(false) };

function creationRules(e: { kind: string; workoutId?: string | undefined; eventInfo?: unknown }, ctx: z.RefinementCtx) {
  if (e.kind === 'workout' && !e.workoutId) {
    ctx.addIssue({ code: 'custom', path: ['workoutId'], message: 'A workout session needs a library workoutId (create_workout first).' });
  }
  if (e.eventInfo && e.kind !== 'race') {
    ctx.addIssue({ code: 'custom', path: ['eventInfo'], message: 'Only a race carries event details (kind "race").' });
  }
}

export const calendarEventInputSchema = calendarEventFields.extend(creationDefaults).superRefine(creationRules);
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
  /** The event has a course (DECISIONS #99). Server-set only, never from a patch or the coach. */
  courseId: z.string().optional(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** Optional fields an edit can clear (an empty start time, deleted notes, a stale range label). */
export const clearableEventFields = ['startTime', 'coachNote', 'meta', 'durationMin', 'durationLabel', 'eventInfo', 'zwiftRouteId', 'zwiftLaps'] as const;
export type ClearableEventField = (typeof clearableEventFields)[number];

export const calendarEventPatchSchema = calendarEventFields.partial().extend({
  status: z.enum(eventStatuses).optional(),
  /** Fields to remove. A field both set and unset keeps the set value. Not offered to the coach. */
  unset: z.array(z.enum(clearableEventFields)).optional(),
});
export type CalendarEventPatch = z.infer<typeof calendarEventPatchSchema>;

/**
 * What the coach's tools take: the same, without the Zwift route fields (DECISIONS #102). The coach
 * can't set them, and they stay out of the cached tool schemas for every account.
 */
const coachEventFields = calendarEventFields.omit({ zwiftRouteId: true, zwiftLaps: true });
export const coachEventInputSchema = coachEventFields.extend(creationDefaults).superRefine(creationRules);
export const coachEventPatchSchema = coachEventFields.partial();

export const calendarRangeQuerySchema = z.object({ from: isoDateSchema, to: isoDateSchema });

/** Deleting an event: `goal=remove` takes its goal too; otherwise the goal stays, unlinked (DECISIONS #100). */
export const calendarDeleteQuerySchema = z.object({ goal: z.literal('remove').optional() });

/** Kinds that live on the intervals.icu calendar too. */
export const syncedKinds: readonly SessionKind[] = ['workout', 'race'];

/** Group a same-day ride into a session (the user's action only). */
export const sessionRideInputSchema = z.object({ activityId: z.string().min(1) });
export type SessionRideInput = z.infer<typeof sessionRideInputSchema>;
