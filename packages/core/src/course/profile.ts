import type { CourseAnalysis } from '@cycling-coach/shared';
import { formatKm, formatMeters } from '../event-info';

export interface ProfileBar {
  /** The bar's middle, km from the start. */
  km: number;
  ele: number;
  /** 0–100, scaled between a floor a little under the lowest point and the highest. */
  height: number;
  /** The climb it's on (its `n`), or 0. */
  climb: number;
}

/**
 * The elevation chart as bars, the way the workout charts are drawn: about one per km, at least 40 and
 * at most `max`, each the height of the course at its middle and marked with the climb it's on.
 */
export function profileBars(course: Pick<CourseAnalysis, 'distanceKm' | 'profile' | 'climbs'>, max = 160): ProfileBar[] {
  const p = course.profile;
  if (p.length < 2) return [];
  const count = Math.min(max, Math.max(40, Math.round(course.distanceKm)));
  const width = course.distanceKm / count;
  const eleAt = (km: number) => {
    let i = 0;
    while (i < p.length - 2 && p[i + 1]![0] < km) i++;
    const [k0, e0] = p[i]!;
    const [k1, e1] = p[i + 1]!;
    return k1 > k0 ? e0 + ((e1 - e0) * (km - k0)) / (k1 - k0) : e0;
  };
  const bars = Array.from({ length: count }, (_, i) => {
    const km = (i + 0.5) * width;
    const climb = course.climbs.find((c) => km >= c.startKm && km <= c.startKm + c.lengthKm)?.n ?? 0;
    return { km, ele: eleAt(km), climb };
  });
  const top = Math.max(...bars.map((b) => b.ele));
  const low = Math.min(...bars.map((b) => b.ele));
  const floor = low - (top - low) * 0.1;
  return bars.map((b) => ({ ...b, height: top > floor ? Math.round(((b.ele - floor) / (top - floor)) * 100) : 50 }));
}

/** Where each climb's marker sits over the chart, as a percentage of the course. */
export function climbMarkers(course: Pick<CourseAnalysis, 'distanceKm' | 'climbs'>): { n: number; leftPct: number; longest: boolean }[] {
  return course.climbs.map((c) => ({ n: c.n, leftPct: ((c.startKm + c.lengthKm / 2) / course.distanceKm) * 100, longest: c.longest }));
}

/** "142 km · 2,350 m · 3 climbs", or "142 km" for a file without elevation. */
export function courseSummary(course: Pick<CourseAnalysis, 'distanceKm' | 'ascentM' | 'climbs'>): string {
  if (course.ascentM === null) return formatKm(course.distanceKm);
  const climbs = course.climbs.length === 1 ? '1 climb' : `${course.climbs.length} climbs`;
  return [formatKm(course.distanceKm), formatMeters(course.ascentM), climbs].join(' · ');
}

/**
 * A course in one line for the coach's events block: "3 climbs, longest 11.1 km at 6.3% from km 95.9;
 * last 20 km +178 m". `get_event_course` has the rest.
 */
export function courseLine(course: Pick<CourseAnalysis, 'ascentM' | 'climbs' | 'finishGainM' | 'terrain'>): string {
  if (course.ascentM === null) return 'course without elevation';
  const longest = course.climbs.find((c) => c.longest);
  const climbs = course.climbs.length
    ? `${course.climbs.length === 1 ? '1 climb' : `${course.climbs.length} climbs`}${longest ? `, longest ${longest.lengthKm} km at ${longest.avgPct}% from km ${longest.startKm}` : ''}`
    : `${course.terrain ?? 'flat'}, no climbs`;
  return `${climbs}; last 20 km +${formatMeters(course.finishGainM ?? 0)}`;
}

/** The course's height at every whole km from the start, for `get_event_course`'s per-km view. */
export function elevationPerKm(course: Pick<CourseAnalysis, 'distanceKm' | 'profile'>): number[] {
  const p = course.profile;
  if (p.length < 2) return [];
  const out: number[] = [];
  let i = 0;
  for (let km = 0; km <= course.distanceKm; km++) {
    while (i < p.length - 2 && p[i + 1]![0] < km) i++;
    const [k0, e0] = p[i]!;
    const [k1, e1] = p[i + 1]!;
    out.push(Math.round(k1 > k0 ? e0 + ((e1 - e0) * Math.min(1, Math.max(0, (km - k0) / (k1 - k0)))) : e0));
  }
  return out;
}
