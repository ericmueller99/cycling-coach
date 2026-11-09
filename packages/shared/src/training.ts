/**
 * Training data in our own shapes, from intervals.icu (produced by apps/api/src/providers/intervals-icu;
 * nothing outside that folder sees intervals.icu payloads) or a deployment's own ride source (DECISIONS #71).
 */
export interface Activity {
  id: string;
  /** Which ride source this came from, when it isn't intervals.icu (DECISIONS #71). Its ids start with `<provider>:`. */
  provider?: string | undefined;
  /** How to name the source on screen, for a ride with a `provider`. */
  sourceLabel?: string | undefined;
  name: string;
  description?: string | undefined;
  /** intervals.icu sport type, e.g. "VirtualRide", "Ride". */
  type: string;
  /** Local wall-clock start, `YYYY-MM-DDTHH:mm:ss`. */
  startLocal: string;
  /** Where intervals.icu got it from (ZWIFT, GARMIN_CONNECT, …). */
  source?: string | undefined;
  isTrainer?: boolean | undefined;
  isRace?: boolean | undefined;
  distanceM: number;
  movingSec: number;
  elapsedSec: number;
  elevationM?: number | undefined;
  avgWatts?: number | undefined;
  /** Normalized/weighted power. */
  normalizedWatts?: number | undefined;
  /** Intensity factor as a percentage of FTP (84 = IF 0.84). */
  intensityPct?: number | undefined;
  trainingLoad?: number | undefined;
  ftp?: number | undefined;
  avgHr?: number | undefined;
  avgCadence?: number | undefined;
  /** Mechanical work in kJ (power activities). For cycling, kJ of work ≈ kcal burned. */
  kilojoules?: number | undefined;
  /** The device's calorie estimate (Garmin, Zwift). */
  calories?: number | undefined;
  /** intervals.icu's detected-interval summary, e.g. ["6x 1m58s 419w"]. */
  intervalSummary?: string[] | undefined;
  /** The intervals.icu planned event this ride was paired with, if any. */
  pairedEventId?: number | undefined;
  /** intervals.icu tags ("race", "zrl", …), for `#tag` search. */
  tags?: string[] | undefined;
}

/** A completed ride on the calendar, tagged with the session it completed (if any). */
export type CalendarActivity = Activity & { matchedEventId?: string | undefined };

/** Several rides counted as one — a session ridden in pieces. */
export interface RideTotals {
  count: number;
  movingSec: number;
  distanceM: number;
  trainingLoad?: number | undefined;
  /** Time-weighted. */
  avgWatts?: number | undefined;
  /** Combined from each ride's NP, weighted by time (fourth-power mean). */
  normalizedWatts?: number | undefined;
  /** As on `Activity`: a percentage of FTP. */
  intensityPct?: number | undefined;
}

export interface ActivityInterval {
  /** WORK, RECOVERY, … */
  type: string;
  label?: string | undefined;
  durationSec: number;
  avgWatts?: number | undefined;
  normalizedWatts?: number | undefined;
  intensityPct?: number | undefined;
  zone?: number | undefined;
  avgCadence?: number | undefined;
  avgHr?: number | undefined;
}

export interface ActivityDetail {
  activity: Activity;
  intervals: ActivityInterval[];
  /** Best power for standard durations within this ride. */
  powerCurve?: PowerPoint[] | undefined;
}

export interface PowerPoint {
  durationSec: number;
  watts: number;
  activityId?: string | undefined;
}

export type PowerCurvePeriod = '90d' | 'season' | '1y' | 'allTime';

export interface PowerCurve {
  period: PowerCurvePeriod;
  label: string;
  /** Local dates the curve covers. */
  start: string;
  end: string;
  points: PowerPoint[];
}

/** One day of the fitness model: CTL (fitness), ATL (fatigue), form = CTL − ATL. */
export interface FitnessDay {
  date: string;
  ctl: number;
  atl: number;
  form: number;
  rampRate?: number | undefined;
  weightKg?: number | undefined;
}

/** intervals.icu's 1–4 wellness scales. What 1 means depends on the field (see `core.readiness`). */
export type WellnessScale = 1 | 2 | 3 | 4;

/**
 * One day of intervals.icu wellness as we store it (DECISIONS #49): the fitness model, the scale's
 * weigh-in and steps, and recovery for the coach (DECISIONS #103): HRV, resting HR, sleep, and the
 * athlete's own 1–4 entries. Any field can be missing on a given day.
 */
export interface WellnessDay {
  date: string;
  ctl?: number | undefined;
  atl?: number | undefined;
  rampRate?: number | undefined;
  weightKg?: number | undefined;
  steps?: number | undefined;
  /** rMSSD, from whatever device feeds intervals.icu. */
  hrvMs?: number | undefined;
  restingHr?: number | undefined;
  sleepSec?: number | undefined;
  sleepScore?: number | undefined;
  /** A device's readiness or recovery score (0–100). */
  readiness?: number | undefined;
  sleepQuality?: WellnessScale | undefined;
  soreness?: WellnessScale | undefined;
  fatigue?: WellnessScale | undefined;
  stress?: WellnessScale | undefined;
  mood?: WellnessScale | undefined;
  motivation?: WellnessScale | undefined;
}

/** Daily step count (watch or phone → intervals.icu wellness). */
export interface StepDay {
  date: string;
  steps: number;
}

export interface IntegrationStatus {
  status: 'connected' | 'not_configured' | 'error';
  athleteId?: string | undefined;
  /** intervals.icu can forward planned workouts to Zwift when this is true. */
  zwiftConnected?: boolean | undefined;
  /** What intervals.icu has for the athlete's FTP — shown next to the profile value. */
  ftp?: number | undefined;
  lastSyncAt?: string | undefined;
  lastError?: string | undefined;
  /** When the last full import of all history finished. */
  lastFullSyncAt?: string | undefined;
  /** The full import's progress, while one runs (or how the last one ended). */
  fullSync?: FullSyncProgress | undefined;
}

/**
 * A full import of intervals.icu history (DECISIONS #49), paced at one request a second:
 * rides quarter by quarter back to the first, wellness year by year, then each ride's detected
 * intervals, then done/missed across everything. `total` is unknown (0) while rides are listed.
 */
export interface FullSyncProgress {
  status: 'running' | 'done' | 'failed';
  phase: 'activities' | 'wellness' | 'details' | 'match';
  /** "2019 Q3", "2021", … — where the current phase is. */
  label?: string | undefined;
  done: number;
  total: number;
  /** Rides found so far. */
  rides: number;
  startedAt: string;
  finishedAt?: string | undefined;
  /** Set while waiting out a rate limit or an outage; the job resumes on the next sync. */
  waitingUntil?: string | undefined;
  error?: string | undefined;
}

/** The Zwift metrics sync (DECISIONS #23). */
export interface ZwiftStatus {
  status: 'connected' | 'not_configured' | 'error';
  zwiftId?: string | undefined;
  lastSyncAt?: string | undefined;
  lastError?: string | undefined;
}
