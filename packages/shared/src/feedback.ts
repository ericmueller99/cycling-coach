import { z } from 'zod';
import type { IsoDate } from './common';
import type { Activity, RideTotals } from './training';

/** How hard a ride felt, 1 (very easy) to 10 (max). */
export const rpeSchema = z.number().int().min(1).max(10);

/**
 * The athlete's optional rating of a ride: keyed by the calendar session it completed, or by the ride
 * itself when nothing was planned. No defaults — this is also the edit (rule 1b).
 */
export const sessionFeedbackInputSchema = z
  .object({
    eventId: z.string().min(1).optional(),
    activityId: z.string().min(1).optional(),
    rpe: rpeSchema,
    /** In their own words; the coach reads it with the ride data. */
    note: z.string().max(1000).optional(),
  })
  .refine((f) => !!f.eventId !== !!f.activityId, { message: 'Rate either a session (eventId) or a ride (activityId).' });
export type SessionFeedbackInput = z.infer<typeof sessionFeedbackInputSchema>;

export interface SessionFeedback {
  id: string;
  eventId?: string | undefined;
  /** The rated ride — also set for a session matched to one, so ride lookups find it. */
  activityId?: string | undefined;
  /** Local date of the session / ride. */
  date: IsoDate;
  /** Session title (or ride name) when rated. */
  title: string;
  /** The library workout the session was, if any. */
  workoutId?: string | undefined;
  rpe: number;
  note?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/** Planned work reps vs what intervals.icu detected (the result banner). */
export interface SessionCompliance {
  /** Duration-weighted actual rep power ÷ planned, as a percentage. */
  pct: number;
  band: 'hit' | 'close' | 'under';
  /** Paired reps that reached ≥ 90% of their target. */
  repsDone: number;
  repsPlanned: number;
  /** Typical planned rep length (the most common work-step duration). */
  repSec: number;
  /** Average actual rep length over the paired reps. */
  actualRepSec: number;
  plannedWatts: number;
  actualWatts: number;
  /** Detected efforts that aren't one of the planned reps (e.g. a warm-up opener). */
  extras: { durationSec: number; watts: number }[];
}

/** A completed session's ride and how it compared with the plan. */
export interface SessionResult {
  /** The primary (matched) ride. */
  activity: Activity;
  /** Every ride of the session, by start time — more than one when the user grouped rides into it. */
  rides: Activity[];
  totals: RideTotals;
  /** Null when the session isn't a library workout, or no detected interval lines up with a rep. */
  compliance: SessionCompliance | null;
}
