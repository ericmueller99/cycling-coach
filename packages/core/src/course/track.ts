import { COURSE_MAX_POINTS, type CoursePoint } from '@cycling-coach/shared';
import { GpxError, type GpxPoint } from './gpx';

/** The spacing a course is stored at: fine enough for 200 m gradients, small enough to send. */
export const RESAMPLE_STEP_M = 50;

const EARTH_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: Pick<GpxPoint, 'lat' | 'lon'>, b: Pick<GpxPoint, 'lat' | 'lon'>): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Elevation at every point, or null when too few points have one to trust (under half): some route
 * exports carry heights only at a few waypoints. Gaps are filled from the nearest known height.
 */
function heights(points: readonly GpxPoint[]): number[] | null {
  const known = points.filter((p) => p.ele !== undefined).length;
  if (known < points.length / 2) return null;
  const out: number[] = [];
  let last: number | undefined;
  for (const p of points) {
    if (p.ele !== undefined) last = p.ele;
    out.push(last ?? NaN);
  }
  const first = out.find((e) => !Number.isNaN(e))!;
  return out.map((e) => (Number.isNaN(e) ? first : e));
}

/**
 * A GPX track at an even spacing: a point every 50 m (wider on very long courses, to stay within
 * `COURSE_MAX_POINTS`), with the end point last. Duplicate points are skipped. What the browser sends
 * and the API stores; the analysis runs on this, never the raw file.
 */
export function resampleTrack(points: readonly GpxPoint[]): CoursePoint[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + haversineM(points[i - 1]!, points[i]!));
  const total = cum[cum.length - 1]!;
  if (total < RESAMPLE_STEP_M) throw new GpxError('no_route');
  const ele = heights(points);
  const step = Math.max(RESAMPLE_STEP_M, Math.ceil(total / (COURSE_MAX_POINTS - 1)));

  const out: CoursePoint[] = [];
  let j = 0;
  const at = (t: number): CoursePoint => {
    while (j < cum.length - 2 && cum[j + 1]! < t) j++;
    const span = cum[j + 1]! - cum[j]!;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - cum[j]!) / span)) : 0;
    const a = points[j]!;
    const b = points[j + 1]!;
    const e = ele ? ele[j]! + (ele[j + 1]! - ele[j]!) * f : null;
    return [round(t / 1000, 3), e === null ? null : round(e, 1), round(a.lat + (b.lat - a.lat) * f, 5), round(a.lon + (b.lon - a.lon) * f, 5)];
  };
  for (let t = 0; t < total; t += step) out.push(at(t));
  out.push(at(total));
  return out;
}
