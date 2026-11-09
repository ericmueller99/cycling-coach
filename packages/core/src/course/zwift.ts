import { COURSE_MAX_POINTS, type Climb, type ClimbCategory, type CourseAnalysis, type CoursePoint, type CourseSegment } from '@cycling-coach/shared';
import { terrainFor } from '../events/routes';
import { analyzeCourse, climbing, FINISH_KM, measureClimb, smoothedTrack } from './analyze';
import { RESAMPLE_STEP_M } from './track';

/**
 * A Zwift race's course from its route (DECISIONS #102): one lap's height by distance, laid out as
 * the lead-in, then the lap as many times as the race has laps. Pure; the API supplies the data.
 */

/** One lap of a route: distance from the route's start (m) and height (m), index-aligned. */
export interface RouteStream {
  distanceM: readonly number[];
  altitudeM: readonly number[];
}

/** A named segment on one lap, at km from the lap's start (zwift-data's `segmentsOnRoute`). */
export interface RouteSegmentOnLap {
  fromKm: number;
  toKm: number;
  name: string;
  kind: CourseSegment['kind'];
  category?: ClimbCategory | undefined;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** The lap's length in km: the stream's last distance. */
export const lapKmOf = (s: RouteStream) => (s.distanceM[s.distanceM.length - 1] ?? 0) / 1000;

/** Height at `d` metres into the lap, interpolated. `distanceM` must not decrease. */
function heightAt(s: RouteStream, d: number): number {
  const { distanceM: dist, altitudeM: alt } = s;
  if (d <= dist[0]!) return alt[0]!;
  if (d >= dist[dist.length - 1]!) return alt[alt.length - 1]!;
  let lo = 0;
  let hi = dist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const span = dist[hi]! - dist[lo]!;
  const f = span > 0 ? (d - dist[lo]!) / span : 0;
  return alt[lo]! + (alt[hi]! - alt[lo]!) * f;
}

/**
 * The race's track at an even spacing, like `resampleTrack`: every 50 m, wider when that would pass
 * `COURSE_MAX_POINTS`. The lead-in has no height data, so it's drawn flat at the lap's starting height.
 * Lat/lon are 0: only km and height are ever read, and this track is never stored.
 */
export function zwiftRouteTrack(stream: RouteStream, opts: { leadinKm: number; laps: number }): CoursePoint[] {
  const lapM = lapKmOf(stream) * 1000;
  if (stream.distanceM.length < 2 || stream.distanceM.length !== stream.altitudeM.length || !(lapM > 0)) return [];
  const laps = Math.max(1, Math.floor(opts.laps));
  const leadM = Math.max(0, opts.leadinKm * 1000);
  const total = leadM + laps * lapM;
  const step = Math.max(RESAMPLE_STEP_M, Math.ceil(total / (COURSE_MAX_POINTS - 1)));
  const at = (t: number): CoursePoint => {
    let e: number;
    if (t <= leadM) e = stream.altitudeM[0]!;
    else {
      const into = t - leadM;
      const lap = Math.min(laps - 1, Math.floor(into / lapM));
      e = heightAt(stream, into - lap * lapM);
    }
    return [round(t / 1000, 3), round(e, 1), 0, 0];
  };
  const out: CoursePoint[] = [];
  for (let t = 0; t < total; t += step) out.push(at(t));
  out.push(at(total));
  return out;
}

/** Each named segment once per lap, at km from the start of the race, in the order they're ridden. */
export function zwiftSegments(onLap: readonly RouteSegmentOnLap[], opts: { leadinKm: number; lapKm: number; laps: number }): CourseSegment[] {
  const laps = Math.max(1, Math.floor(opts.laps));
  const out: CourseSegment[] = [];
  for (let lap = 1; lap <= laps; lap++) {
    const offset = opts.leadinKm + (lap - 1) * opts.lapKm;
    for (const s of onLap) {
      out.push({
        name: s.name,
        kind: s.kind,
        lap,
        startKm: round(offset + s.fromKm, 3),
        endKm: round(offset + s.toKm, 3),
        ...(s.category ? { category: s.category } : {}),
      });
    }
  }
  return out.sort((a, b) => a.startKm - b.startKm);
}

const overlaps = (a: Pick<Climb, 'startKm' | 'lengthKm'>, b: Pick<Climb, 'startKm' | 'lengthKm'>) =>
  a.startKm < b.startKm + b.lengthKm && b.startKm < a.startKm + a.lengthKm;

/**
 * `analyzeCourse`, with the route's named climbs in place of the found climbs they overlap. A named
 * climb is measured from the same smoothed heights, and counts whatever its size: Zwift times it. Found
 * climbs elsewhere stay, unnamed. Then everything is numbered from the start and the longest marked.
 *
 * Climbing is counted on the heights as they are. A Zwift route has no GPS noise, and the smoothing
 * meant for a GPX flattens its short rollers: it came out a median 24% under the routes' published
 * climbing, against about 0% raw.
 */
export function analyzeZwiftCourse(track: readonly CoursePoint[], segments: readonly CourseSegment[]): CourseAnalysis {
  const base = analyzeCourse(track);
  const t = smoothedTrack(track);
  if (!t) return base;
  const named = segments
    .filter((s) => s.kind === 'climb')
    .map((s) => ({ ...measureClimb(t, s.startKm, s.endKm), name: s.name, ...(s.category ? { category: s.category } : {}) }))
    .filter((c) => c.lengthKm > 0);
  const found = base.climbs.filter((c) => !named.some((n) => overlaps(c, n))).map(({ n: _n, longest: _l, ...c }) => c);
  const all = [...named, ...found].sort((a, b) => a.startKm - b.startKm);
  const longest = all.reduce((best, c, i) => (c.lengthKm > (all[best]?.lengthKm ?? -1) ? i : best), -1);
  const raw = track.map((p) => p[1]!);
  const { up, down } = climbing(raw, 0);
  const lastKm = track[track.length - 1]![0];
  const finishFrom = Math.max(0, track.findIndex((p) => p[0] >= lastKm - FINISH_KM));
  return {
    ...base,
    ascentM: round(up, 0),
    descentM: round(down, 0),
    terrain: terrainFor(base.distanceKm, up),
    finishGainM: round(climbing(raw.slice(finishFrom), 0).up, 0),
    climbs: all.map((c, i) => ({ ...c, n: i + 1, longest: i === longest })),
  };
}
