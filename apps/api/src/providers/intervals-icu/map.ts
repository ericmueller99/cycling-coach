import { describeEventInfo, workoutMetrics, zwoFileName } from '@cycling-coach/core';
import type {
  Activity,
  ActivityInterval,
  CalendarEvent,
  Platform,
  PowerCurve,
  PowerCurvePeriod,
  PowerPoint,
  WellnessDay,
  WellnessScale,
  Workout,
} from '@cycling-coach/shared';

/**
 * intervals.icu payloads → our DTOs, and our sessions → intervals.icu events. Pure, so it's
 * fixture-tested. Field names were checked against the live API and its OpenAPI spec (2026-10-30).
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** intervals.icu reports "no data" as 0 for HR and power; treat that as absent. */
const pos = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * intervals.icu won't share some activities (those from Strava; Garmin's may follow): they come back
 * as empty placeholders with a `_note`. Nothing to show or coach from, but the ride still exists.
 */
function isPlaceholder(raw: Record<string, unknown>): boolean {
  return raw['_note'] !== undefined && !num(raw['moving_time']);
}

export function mapActivity(raw: unknown): Activity | null {
  if (!isObj(raw)) return null;
  if (isPlaceholder(raw)) return null;
  const id = str(raw['id']) ?? (num(raw['id']) !== undefined ? String(raw['id']) : undefined);
  const startLocal = str(raw['start_date_local']);
  if (!id || !startLocal) return null;
  const intensity = num(raw['icu_intensity']);
  const summary = Array.isArray(raw['interval_summary'])
    ? raw['interval_summary'].filter((x): x is string => typeof x === 'string')
    : undefined;
  return {
    id,
    name: str(raw['name']) ?? 'Activity',
    description: str(raw['description']),
    type: str(raw['type']) ?? 'Ride',
    startLocal: startLocal.slice(0, 19),
    source: str(raw['source']),
    isTrainer: typeof raw['trainer'] === 'boolean' ? raw['trainer'] : undefined,
    isRace: typeof raw['race'] === 'boolean' ? raw['race'] : undefined,
    distanceM: num(raw['distance']) ?? num(raw['icu_distance']) ?? 0,
    movingSec: num(raw['moving_time']) ?? 0,
    elapsedSec: num(raw['elapsed_time']) ?? num(raw['moving_time']) ?? 0,
    elevationM: pos(raw['total_elevation_gain']),
    avgWatts: pos(raw['icu_average_watts']),
    normalizedWatts: pos(raw['icu_weighted_avg_watts']),
    intensityPct: intensity !== undefined && intensity > 0 ? Math.round(intensity) : undefined,
    trainingLoad: num(raw['icu_training_load']),
    ftp: pos(raw['icu_ftp']),
    avgHr: pos(raw['average_heartrate']),
    avgCadence: pos(raw['average_cadence']),
    kilojoules: pos(raw['icu_joules']) !== undefined ? Math.round(num(raw['icu_joules'])! / 1000) : undefined,
    calories: pos(raw['calories']),
    intervalSummary: summary?.length ? summary : undefined,
    pairedEventId: pos(raw['paired_event_id']),
    tags: Array.isArray(raw['tags']) && raw['tags'].some((t) => typeof t === 'string')
      ? raw['tags'].filter((t): t is string => typeof t === 'string')
      : undefined,
  };
}

export function mapActivities(raw: unknown): Activity[] {
  return Array.isArray(raw) ? raw.map(mapActivity).filter((a): a is Activity => a !== null) : [];
}

/** The placeholders in a listing, by id: a ride we stored before it was hidden stays stored (DECISIONS #71). */
export function hiddenActivityIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!isObj(r) || !isPlaceholder(r)) return [];
    const id = str(r['id']) ?? (num(r['id']) !== undefined ? String(r['id']) : undefined);
    return id ? [id] : [];
  });
}

export function mapInterval(raw: unknown): ActivityInterval | null {
  if (!isObj(raw)) return null;
  const durationSec = num(raw['moving_time']) ?? num(raw['elapsed_time']);
  if (!durationSec) return null;
  return {
    type: str(raw['type']) ?? 'INTERVAL',
    label: str(raw['label']),
    durationSec,
    avgWatts: pos(raw['average_watts']),
    normalizedWatts: pos(raw['weighted_average_watts']),
    intensityPct: pos(raw['intensity']) !== undefined ? Math.round(num(raw['intensity'])!) : undefined,
    zone: pos(raw['zone']),
    avgCadence: pos(raw['average_cadence']),
    avgHr: pos(raw['average_heartrate']),
  };
}

/** `secs` + `values` (athlete curves) or `watts` (activity curves), with optional `activity_id`. */
export function mapCurvePoints(raw: unknown, durations?: readonly number[]): PowerPoint[] {
  if (!isObj(raw) || !Array.isArray(raw['secs'])) return [];
  const secs = raw['secs'] as unknown[];
  const values = (Array.isArray(raw['values']) ? raw['values'] : Array.isArray(raw['watts']) ? raw['watts'] : []) as unknown[];
  const ids = Array.isArray(raw['activity_id']) ? (raw['activity_id'] as unknown[]) : [];
  const points: PowerPoint[] = [];
  secs.forEach((s, i) => {
    const durationSec = num(s);
    const watts = pos(values[i]);
    if (durationSec === undefined || watts === undefined) return;
    if (durations && !durations.includes(durationSec)) return;
    const activityId = str(ids[i]);
    points.push({ durationSec, watts: Math.round(watts), ...(activityId ? { activityId } : {}) });
  });
  return points;
}

/** Our period names ↔ intervals.icu curve ids. `s0` is "this season" as set in intervals.icu. */
export const CURVE_IDS: Record<PowerCurvePeriod, string> = { '90d': '90d', season: 's0', '1y': '1y', allTime: 'all' };
const PERIOD_BY_ID = Object.fromEntries(Object.entries(CURVE_IDS).map(([k, v]) => [v, k])) as Record<string, PowerCurvePeriod>;

export function mapPowerCurves(raw: unknown): PowerCurve[] {
  const list = isObj(raw) && Array.isArray(raw['list']) ? raw['list'] : [];
  const out: PowerCurve[] = [];
  for (const c of list) {
    if (!isObj(c)) continue;
    const period = PERIOD_BY_ID[str(c['id']) ?? ''];
    if (!period) continue;
    out.push({
      period,
      label: str(c['label']) ?? period,
      start: (str(c['start_date_local']) ?? '').slice(0, 10),
      end: (str(c['end_date_local']) ?? '').slice(0, 10),
      points: mapCurvePoints(c),
    });
  }
  return out;
}

/** One of intervals.icu's 1–4 wellness entries, or nothing (it sends null or 0 for "not entered"). */
const scale = (v: unknown): WellnessScale | undefined => {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) && n >= 1 && n <= 4 ? (n as WellnessScale) : undefined;
};

/** The recovery fields of a wellness row: device numbers rounded, the athlete's own 1–4 entries as given. */
function recovery(w: Record<string, unknown>): Partial<WellnessDay> {
  const out: Partial<WellnessDay> = {};
  const hrv = pos(w['hrv']);
  if (hrv !== undefined) out.hrvMs = Math.round(hrv);
  const rhr = pos(w['restingHR']);
  if (rhr !== undefined) out.restingHr = Math.round(rhr);
  const sleep = pos(w['sleepSecs']);
  if (sleep !== undefined) out.sleepSec = Math.round(sleep);
  const score = pos(w['sleepScore']);
  if (score !== undefined) out.sleepScore = Math.round(score);
  const ready = pos(w['readiness']);
  if (ready !== undefined) out.readiness = Math.round(ready);
  for (const k of ['sleepQuality', 'soreness', 'fatigue', 'stress', 'mood', 'motivation'] as const) {
    const v = scale(w[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Wellness rows → our stored days (DECISIONS #49): CTL/ATL to one decimal, the scale's weigh-in
 * and steps, and the recovery fields the coach reads (DECISIONS #103). intervals.icu reports a
 * missing value as null or 0; those stay out. A day with none of these is dropped.
 */
export function mapWellnessDays(raw: unknown): WellnessDay[] {
  if (!Array.isArray(raw)) return [];
  const round1 = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 10) / 10);
  const out: WellnessDay[] = [];
  for (const w of raw) {
    if (!isObj(w)) continue;
    const date = str(w['id']);
    if (!date) continue;
    const ctl = num(w['ctl']);
    const atl = num(w['atl']);
    const both = ctl !== undefined && atl !== undefined;
    const steps = pos(w['steps']);
    const day: WellnessDay = {
      date,
      ...(both ? { ctl: round1(ctl), atl: round1(atl) } : {}),
      ...(both && num(w['rampRate']) !== undefined ? { rampRate: round1(num(w['rampRate'])) } : {}),
      ...(pos(w['weight']) !== undefined ? { weightKg: round1(pos(w['weight'])) } : {}),
      ...(steps !== undefined ? { steps: Math.round(steps) } : {}),
      ...recovery(w),
    };
    if (Object.keys(day).length > 1) out.push(day);
  }
  return out;
}

/** An intervals.icu calendar event we care about: planned workouts and races. */
export interface RemoteEvent {
  id: number;
  date: string;
  startTime?: string | undefined;
  kind: 'workout' | 'race';
  platform: Platform;
  priority?: 'A' | 'B' | 'C' | undefined;
  name: string;
  description?: string | undefined;
  movingSec?: number | undefined;
  /** intervals.icu's last-modified timestamp. */
  updated?: string | undefined;
  uid?: string | undefined;
  externalId?: string | undefined;
}

export const SYNCED_CATEGORIES = ['WORKOUT', 'RACE_A', 'RACE_B', 'RACE_C'] as const;

export function mapRemoteEvent(raw: unknown): RemoteEvent | null {
  if (!isObj(raw)) return null;
  const id = num(raw['id']);
  const start = str(raw['start_date_local']);
  const category = str(raw['category']);
  if (id === undefined || !start || !category || !(SYNCED_CATEGORIES as readonly string[]).includes(category)) return null;
  const type = str(raw['type']) ?? 'Ride';
  // Zwift = indoor or a virtual ride. Older imports flag neither but say "Virtual Ride" in the name.
  const name = str(raw['name']) ?? (category === 'WORKOUT' ? 'Workout' : 'Race');
  const indoor = raw['indoor'] === true || type === 'VirtualRide' || /virtual ride|zwift/i.test(name);
  const time = start.slice(11, 16);
  return {
    id,
    date: start.slice(0, 10),
    startTime: time && time !== '00:00' ? time : undefined,
    kind: category === 'WORKOUT' ? 'workout' : 'race',
    platform: indoor ? 'zwift' : 'garmin',
    priority: category.startsWith('RACE_') ? (category.slice(5) as 'A' | 'B' | 'C') : undefined,
    name,
    description: str(raw['description']),
    movingSec: pos(raw['moving_time']),
    updated: str(raw['updated']),
    uid: str(raw['uid']),
    externalId: str(raw['external_id']),
  };
}

export function mapRemoteEvents(raw: unknown): RemoteEvent[] {
  return Array.isArray(raw) ? raw.map(mapRemoteEvent).filter((e): e is RemoteEvent => e !== null) : [];
}

/**
 * Our marker on events we create. intervals.icu assigns its own `uid` but keeps `external_id`, so
 * this is how a sync recognises its own events (e.g. after a create whose response was lost).
 */
const EXTERNAL_PREFIX = 'cycling-coach:';
export const externalIdFor = (eventId: string) => `${EXTERNAL_PREFIX}${eventId}`;
export const ourEventId = (externalId: string | undefined) =>
  externalId?.startsWith(EXTERNAL_PREFIX) ? externalId.slice(EXTERNAL_PREFIX.length) : undefined;

function startDateLocal(event: Pick<CalendarEvent, 'date' | 'startTime'>) {
  return `${event.date}T${event.startTime ?? '00:00'}:00`;
}

/** Zwift → indoor VirtualRide (what intervals.icu forwards to Zwift); Garmin → outdoor Ride. */
function where(platform: Platform | undefined) {
  return platform === 'garmin' ? { type: 'Ride', indoor: false } : { type: 'VirtualRide', indoor: true };
}

/**
 * A planned workout for the intervals.icu calendar. Uploading our own .zwo (rather than
 * intervals.icu's text syntax) means the workout Zwift receives is exactly the one in our library.
 */
export function buildWorkoutEvent(event: CalendarEvent, workout: Workout, zwoXml: string) {
  const description = [event.coachNote, event.meta, workout.description].filter(Boolean).join('\n\n');
  return {
    category: 'WORKOUT',
    start_date_local: startDateLocal(event),
    ...where(event.platform),
    name: event.title,
    // Always sent: an update with no description would keep the old notes there.
    description,
    moving_time: workoutMetrics(workout.segments).totalSec,
    filename: zwoFileName(workout.name),
    file_contents: zwoXml,
    external_id: externalIdFor(event.id),
  };
}

/**
 * A race on the intervals.icu calendar, with its A/B/C priority. A real-world event leads its notes
 * with what it is ("Gran fondo · 142 km · 2,350 m · Harbour Falls, BC · <link>"), DECISIONS #98.
 */
export function buildRaceEvent(event: CalendarEvent) {
  const info = event.eventInfo;
  const eventLine = info ? [describeEventInfo(info), info.location, info.url].filter(Boolean).join(' · ') : '';
  const description = [eventLine, event.coachNote, event.meta].filter(Boolean).join('\n\n');
  return {
    category: `RACE_${event.priority ?? 'B'}`,
    start_date_local: startDateLocal(event),
    ...where(event.platform),
    name: event.title,
    // Always sent: an update with no description would keep the old notes there.
    description,
    ...(event.durationMin ? { moving_time: event.durationMin * 60 } : {}),
    external_id: externalIdFor(event.id),
  };
}
