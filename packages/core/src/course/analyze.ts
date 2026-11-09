import type { Climb, CourseAnalysis, CoursePoint } from '@cycling-coach/shared';
import { terrainFor } from '../events/routes';

/** Bump when the analysis changes, so stored courses are analysed again on read. */
export const COURSE_ANALYSIS_VERSION = 1;

/**
 * Starting guesses, to tune against real courses (DECISIONS #99). A climb is at least this long,
 * steep and high; a dip smaller than `DIP_M` doesn't end it, but no new height for `STALL_KM` does.
 */
const SMOOTH_M = 200;
const HYSTERESIS_M = 2;
const MIN_LENGTH_KM = 0.5;
const MIN_AVG_PCT = 3;
const MIN_GAIN_M = 40;
const DIP_M = 30;
const STALL_KM = 1;
const LEAD_IN_PCT = 2;
const STEEPEST_OVER_M = 200;
export const FINISH_KM = 20;
const PROFILE_POINTS = 300;

const round = (n: number, places = 0) => Math.round(n * 10 ** places) / 10 ** places;

/** A centred moving average over about 200 m, which takes out GPS jitter but keeps a climb's shape. */
function smooth(ele: readonly number[], stepM: number): number[] {
  const half = Math.max(1, Math.round(SMOOTH_M / 2 / stepM));
  return ele.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(ele.length - 1, i + half); k++) {
      sum += ele[k]!;
      n++;
    }
    return sum / n;
  });
}

/**
 * Up and down, counting a change only once it passes a couple of metres, so noise doesn't add up.
 * A clean source (a Zwift route, DECISIONS #102) counts every metre: `hysteresisM` 0.
 */
export function climbing(ele: readonly number[], hysteresisM = HYSTERESIS_M): { up: number; down: number } {
  let up = 0;
  let down = 0;
  let anchor = ele[0] ?? 0;
  for (const e of ele) {
    if (e - anchor > 0 && e - anchor >= hysteresisM) {
      up += e - anchor;
      anchor = e;
    } else if (anchor - e > 0 && anchor - e >= hysteresisM) {
      down += anchor - e;
      anchor = e;
    }
  }
  return { up, down };
}

/**
 * Climbs: from a low point, keep going while it still gains height. A dip under 30 m (or a tenth of
 * the climb so far, if less) doesn't end it, but a bigger drop or a kilometre without new height
 * does, at the highest point. A flat lead-in is trimmed off the start. What's left counts if it's
 * long, steep and high enough.
 */
function findClimbs(km: readonly number[], ele: readonly number[], stepM: number): Omit<Climb, 'n' | 'longest'>[] {
  const out: Omit<Climb, 'n' | 'longest'>[] = [];
  const lead = Math.max(1, Math.round(STEEPEST_OVER_M / stepM));
  let i = 0;
  while (i < ele.length - 1) {
    if (ele[i + 1]! <= ele[i]!) {
      i++;
      continue;
    }
    let start = i;
    let top = i;
    for (let j = i + 1; j < ele.length; j++) {
      if (ele[j]! > ele[top]!) {
        top = j;
        continue;
      }
      const dip = Math.min(DIP_M, Math.max(10, 0.1 * (ele[top]! - ele[start]!)));
      if (ele[top]! - ele[j]! > dip || km[j]! - km[top]! > STALL_KM) break;
    }
    // Trim a flat run-up: the climb starts where the road starts to rise.
    while (start < top - lead && ((ele[start + lead]! - ele[start]!) / ((km[start + lead]! - km[start]!) * 1000)) * 100 < LEAD_IN_PCT) start++;
    const lengthKm = km[top]! - km[start]!;
    const gainM = ele[top]! - ele[start]!;
    const avgPct = lengthKm > 0 ? (gainM / (lengthKm * 1000)) * 100 : 0;
    if (lengthKm >= MIN_LENGTH_KM && gainM >= MIN_GAIN_M && avgPct >= MIN_AVG_PCT) {
      let maxPct = avgPct;
      for (let k = start; k + lead <= top; k++) maxPct = Math.max(maxPct, ((ele[k + lead]! - ele[k]!) / ((km[k + lead]! - km[k]!) * 1000)) * 100);
      out.push({ startKm: round(km[start]!, 1), lengthKm: round(lengthKm, 1), gainM: round(gainM), avgPct: round(avgPct, 1), maxPct: round(maxPct), topM: round(ele[top]!) });
    }
    i = Math.max(top, i + 1);
  }
  return out;
}

/** A track's km and smoothed heights, as the analysis sees them. */
export interface SmoothedTrack {
  km: number[];
  ele: number[];
  stepM: number;
}

/** The km and smoothed heights of a resampled track; null when it has no elevation. */
export function smoothedTrack(track: readonly CoursePoint[]): SmoothedTrack | null {
  if (track.length < 3 || !track.every((p) => p[1] !== null)) return null;
  const km = track.map((p) => p[0]);
  const stepM = Math.max(1, ((km[km.length - 1]! - km[0]!) / (km.length - 1)) * 1000);
  return {
    km,
    ele: smooth(
      track.map((p) => p[1]!),
      stepM,
    ),
    stepM,
  };
}

/**
 * A known stretch measured like a found climb: length, net gain, average, steepest 200 m and top.
 * For a Zwift route's named climbs, which don't have to pass the thresholds (DECISIONS #102).
 */
export function measureClimb(t: SmoothedTrack, fromKm: number, toKm: number): Omit<Climb, 'n' | 'longest'> {
  const { km, ele, stepM } = t;
  let a = km.findIndex((k) => k >= fromKm);
  if (a < 0) a = km.length - 1;
  let b = a;
  while (b + 1 < km.length && km[b + 1]! <= toKm) b++;
  const lengthKm = km[b]! - km[a]!;
  const gainM = ele[b]! - ele[a]!;
  const avgPct = lengthKm > 0 ? (gainM / (lengthKm * 1000)) * 100 : 0;
  const lead = Math.max(1, Math.round(STEEPEST_OVER_M / stepM));
  let maxPct = avgPct;
  for (let k = a; k + lead <= b; k++) maxPct = Math.max(maxPct, ((ele[k + lead]! - ele[k]!) / ((km[k + lead]! - km[k]!) * 1000)) * 100);
  let top = ele[a]!;
  for (let k = a; k <= b; k++) top = Math.max(top, ele[k]!);
  return { startKm: round(km[a]!, 1), lengthKm: round(lengthKm, 1), gainM: round(gainM), avgPct: round(avgPct, 1), maxPct: round(maxPct), topM: round(top) };
}

/** What code can measure from a resampled course (`resampleTrack`). The coach judges what it means. */
export function analyzeCourse(track: readonly CoursePoint[]): CourseAnalysis {
  const distanceKm = round(track[track.length - 1]?.[0] ?? 0, 1);
  const t = smoothedTrack(track);
  if (!t) {
    return { distanceKm, ascentM: null, descentM: null, minM: null, maxM: null, terrain: null, climbs: [], finishGainM: null, profile: [] };
  }
  const { km, ele, stepM } = t;
  const { up, down } = climbing(ele);
  const finishFrom = km.findIndex((k) => k >= km[km.length - 1]! - FINISH_KM);
  const found = findClimbs(km, ele, stepM);
  const longest = found.reduce((best, c, i) => (c.lengthKm > (found[best]?.lengthKm ?? -1) ? i : best), -1);
  const every = Math.max(1, Math.ceil(track.length / PROFILE_POINTS));
  const profile: [number, number][] = [];
  for (let i = 0; i < track.length; i += every) profile.push([round(km[i]!, 2), round(ele[i]!)]);
  if (profile[profile.length - 1]![0] !== round(km[km.length - 1]!, 2)) profile.push([round(km[km.length - 1]!, 2), round(ele[ele.length - 1]!)]);
  return {
    distanceKm,
    ascentM: round(up),
    descentM: round(down),
    minM: round(Math.min(...ele)),
    maxM: round(Math.max(...ele)),
    terrain: terrainFor(distanceKm, up),
    climbs: found.map((c, i) => ({ ...c, n: i + 1, longest: i === longest })),
    finishGainM: round(climbing(ele.slice(Math.max(0, finishFrom))).up),
    profile,
  };
}
