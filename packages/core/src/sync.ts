import type { Activity, FitnessDay, IsoDate, StepDay, WellnessDay } from '@cycling-coach/shared';
import { addDays } from './dates';
import type { WeighIn } from './weight';

/**
 * The intervals.icu sync's date maths (DECISIONS #49): which days a delta run re-reads, the windows
 * a full import walks, and how a stored ride is compared with the one intervals.icu has now.
 */

/** Re-read this many days before the last successful sync: late device uploads, reprocessed loads. */
export const SYNC_OVERLAP_DAYS = 7;

/**
 * A delta run's window: from the last successful sync's local day (less the overlap) to today.
 * After an outage it simply grows. Never synced → `null`; the caller starts a full import and
 * reads the last `SYNC_OVERLAP_DAYS` meanwhile.
 */
export function deltaWindow(lastSyncDay: IsoDate | undefined, today: IsoDate, overlapDays = SYNC_OVERLAP_DAYS): { from: IsoDate; to: IsoDate } | null {
  if (!lastSyncDay) return null;
  const start = lastSyncDay < today ? lastSyncDay : today;
  return { from: addDays(start, -overlapDays), to: today };
}

/** A calendar quarter, the step a full import walks back through (small enough for any page cap). */
export interface Quarter {
  from: IsoDate;
  to: IsoDate;
  /** "2019 Q3", for the progress label. */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The quarter containing `date`. */
export function quarterOf(date: IsoDate): Quarter {
  const year = Number(date.slice(0, 4));
  const q = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  return quarter(year, q);
}

function quarter(year: number, q: number): Quarter {
  const from = `${year}-${pad(q * 3 + 1)}-01`;
  const nextStart = q === 3 ? `${year + 1}-01-01` : `${year}-${pad(q * 3 + 4)}-01`;
  return { from, to: addDays(nextStart, -1), label: `${year} Q${q + 1}` };
}

/** The quarter before this one. */
export function previousQuarter(q: Quarter): Quarter {
  return quarterOf(addDays(q.from, -1));
}

/**
 * A full import stops walking back after this many empty quarters in a row (three years) — no
 * athlete's history has a gap that long and then more rides before it, in practice.
 */
export const EMPTY_QUARTERS_TO_STOP = 12;

/** Whole years from `fromYear` to `toYear`, for the wellness pass of a full import. */
export function yearWindows(fromYear: number, toYear: number): { from: IsoDate; to: IsoDate; year: number }[] {
  const out: { from: IsoDate; to: IsoDate; year: number }[] = [];
  for (let y = fromYear; y <= toYear; y++) out.push({ from: `${y}-01-01`, to: `${y}-12-31`, year: y });
  return out;
}

/**
 * What identifies a version of a ride: the fields intervals.icu changes when it reprocesses one
 * (new FTP, a fixed power file, a rename). A different fingerprint means the stored detected
 * intervals are stale too.
 */
export function activityFingerprint(a: Activity): string {
  return JSON.stringify([
    a.name,
    a.type,
    a.startLocal,
    a.movingSec,
    a.elapsedSec,
    a.distanceM,
    a.trainingLoad ?? null,
    a.normalizedWatts ?? null,
    a.avgWatts ?? null,
    a.ftp ?? null,
    a.kilojoules ?? null,
    a.pairedEventId ?? null,
    a.intervalSummary ?? null,
    a.tags ?? null,
  ]);
}

export interface StoredRideRef {
  id: string;
  fingerprint: string;
}

/**
 * Compare what intervals.icu lists for a window with what we stored for the same window: rides to
 * write (new, or a changed fingerprint) and stored rides it no longer has (deleted there).
 */
export function diffActivities(stored: readonly StoredRideRef[], remote: readonly Activity[]): { changed: Activity[]; removed: string[] } {
  const known = new Map(stored.map((s) => [s.id, s.fingerprint]));
  const seen = new Set(remote.map((a) => a.id));
  return {
    changed: remote.filter((a) => known.get(a.id) !== activityFingerprint(a)),
    removed: stored.filter((s) => !seen.has(s.id)).map((s) => s.id),
  };
}

/** Stored wellness → the fitness model's days (days without CTL/ATL are left out). */
export function fitnessDays(days: readonly WellnessDay[]): FitnessDay[] {
  return days
    .filter((d) => d.ctl !== undefined && d.atl !== undefined)
    .map((d) => ({
      date: d.date,
      ctl: d.ctl!,
      atl: d.atl!,
      form: Math.round((d.ctl! - d.atl!) * 10) / 10,
      ...(d.rampRate !== undefined ? { rampRate: d.rampRate } : {}),
      ...(d.weightKg !== undefined ? { weightKg: d.weightKg } : {}),
    }));
}

export function stepDays(days: readonly WellnessDay[]): StepDay[] {
  return days.filter((d) => d.steps !== undefined).map((d) => ({ date: d.date, steps: d.steps! }));
}

export function weighInsFrom(days: readonly WellnessDay[]): WeighIn[] {
  return days.filter((d) => d.weightKg !== undefined).map((d) => ({ date: d.date, kg: d.weightKg! }));
}
