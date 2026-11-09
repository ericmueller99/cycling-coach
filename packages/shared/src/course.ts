import { z } from 'zod';
import type { Terrain } from './events';

/**
 * An event's course (DECISIONS #99). The browser reads the GPX and sends only the resampled track:
 * one point every 50 m or so, `[km from the start, elevation m (null when the file has none), lat,
 * lon]`. The raw file never leaves the device. The API analyses the track itself with `core`.
 */
export const COURSE_MAX_POINTS = 12_000;

export const coursePointSchema = z.tuple([
  z.number().min(0).max(5000),
  z.number().min(-500).max(9000).nullable(),
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
]);
export type CoursePoint = z.infer<typeof coursePointSchema>;

export const courseInputSchema = z.object({
  name: z.string().max(120).optional(),
  fileName: z.string().max(200).optional(),
  points: z
    .array(coursePointSchema)
    .min(2)
    .max(COURSE_MAX_POINTS)
    .superRefine((pts, ctx) => {
      for (let i = 1; i < pts.length; i++) {
        if (pts[i]![0] < pts[i - 1]![0]) return ctx.addIssue({ code: 'custom', message: 'Course distances must not go backwards.' });
      }
    }),
});
export type CourseInput = z.infer<typeof courseInputSchema>;

/** One climb, numbered from the start. */
export interface Climb {
  n: number;
  startKm: number;
  lengthKm: number;
  gainM: number;
  avgPct: number;
  /** Steepest 200 m inside it. */
  maxPct: number;
  topM: number;
  /** The longest climb on the course. */
  longest: boolean;
  /** A Zwift route's named climb, e.g. "Volcano KOM" (DECISIONS #102). */
  name?: string | undefined;
  /** Its category in Zwift. */
  category?: ClimbCategory | undefined;
}

export const climbCategories = ['HC', '1', '2', '3', '4'] as const;
export type ClimbCategory = (typeof climbCategories)[number];

/** A named Zwift segment on a route, once per lap, at its km from the start (DECISIONS #102). */
export interface CourseSegment {
  name: string;
  kind: 'climb' | 'sprint' | 'segment';
  /** 1-based. */
  lap: number;
  startKm: number;
  endKm: number;
  category?: ClimbCategory | undefined;
}

/** What code measures from a course; the coach judges what it means (DECISIONS #99). */
export interface CourseAnalysis {
  distanceKm: number;
  /** The rest is null when the file had no elevation. */
  ascentM: number | null;
  descentM: number | null;
  minM: number | null;
  maxM: number | null;
  terrain: Terrain | null;
  climbs: Climb[];
  /** Climbing in the last 20 km. */
  finishGainM: number | null;
  /** About 300 `[km, m]` points for the chart; empty without elevation. */
  profile: [number, number][];
}

/** The Zwift route a race's course was built from (DECISIONS #102). */
export interface CourseRoute {
  id: number;
  name: string;
  world?: string | undefined;
  /** The laps drawn: the race's laps, or 1 when it has none (a timed race). */
  laps: number;
  /** The race set no laps, so one lap is shown. */
  lapsUnknown: boolean;
  lapKm: number;
  leadinKm: number;
  /** False when there's no elevation for this route: the analysis is the totals only. */
  hasProfile: boolean;
  zwiftInsiderUrl?: string | undefined;
  whatsOnZwiftUrl?: string | undefined;
}

/** An event's course as the API returns it. */
export interface Course {
  eventId: string;
  name?: string | undefined;
  fileName?: string | undefined;
  analysis: CourseAnalysis;
  /** Where it came from: a GPX the athlete added, or a Zwift route. Absent means GPX. */
  source?: 'gpx' | 'zwift' | undefined;
  route?: CourseRoute | undefined;
  segments?: CourseSegment[] | undefined;
}

/** A Zwift route the race form offers (DECISIONS #102). */
export interface ZwiftRouteOption {
  id: number;
  name: string;
  world?: string | undefined;
  distanceKm: number;
  ascentM: number;
  leadinKm: number;
  leadinAscentM: number;
  /** There's an elevation profile for it. */
  hasProfile: boolean;
}
