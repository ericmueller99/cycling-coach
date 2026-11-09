import type { Climb, CourseAnalysis } from '@cycling-coach/shared';
import { estimateMinutes } from '../events/routes';
import { formatHoursMinutes } from '../event-info';

/**
 * A plain physics model for climbing speed (DECISIONS #99). Every number is a guess for a typical road
 * bike and rider, which is why the app shows a range and calls it an estimate.
 */
export const CLIMB_MODEL = { bikeKg: 9, cda: 0.32, crr: 0.005, airDensity: 1.2, drivetrain: 0.97, g: 9.81 } as const;

/** The share of FTP an event is ridden at on average, for the time estimate a GPX fills in. */
export const EVENT_PACE_FTP = 0.75;

/** Steady speed in m/s at `watts` up a constant grade, from rolling, gravity and air drag. */
export function speedOnGrade(watts: number, riderKg: number, gradePct: number): number {
  const m = riderKg + CLIMB_MODEL.bikeKg;
  const theta = Math.atan(gradePct / 100);
  const resist = m * CLIMB_MODEL.g * (Math.sin(theta) + CLIMB_MODEL.crr * Math.cos(theta));
  const power = (v: number) => v * (resist + 0.5 * CLIMB_MODEL.airDensity * CLIMB_MODEL.cda * v * v);
  const target = watts * CLIMB_MODEL.drivetrain;
  let lo = 0.1;
  let hi = 30;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (power(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Minutes to ride a climb at its average grade and a steady `watts`. */
export function climbMinutes(climb: Pick<Climb, 'lengthKm' | 'avgPct'>, watts: number, riderKg: number): number {
  return (climb.lengthKm * 1000) / speedOnGrade(watts, riderKg, climb.avgPct) / 60;
}

/** The time a climb takes this rider: at FTP (the fast end) and at 90% of it. */
export function climbTimeRange(climb: Pick<Climb, 'lengthKm' | 'avgPct'>, ftp: number, riderKg: number): [number, number] {
  return [climbMinutes(climb, ftp, riderKg), climbMinutes(climb, ftp * 0.9, riderKg)];
}

/** "≈ 10–11 min", "≈ 31–35 min", "≈ 1 h 05–1 h 12". */
export function formatTimeRange([fast, slow]: [number, number]): string {
  const a = Math.round(fast);
  const b = Math.max(a, Math.round(slow));
  if (b < 90) return a === b ? `≈ ${a} min` : `≈ ${a}–${b} min`;
  return a === b ? `≈ ${formatHoursMinutes(a)}` : `≈ ${formatHoursMinutes(a)}–${formatHoursMinutes(b)}`;
}

/**
 * A whole course's riding time at `EVENT_PACE_FTP`, from its distance and climbing — the "from GPX + FTP"
 * estimate the Add event panel fills in. The same model as the Zwift events page's estimates.
 */
export function courseMinutes(course: Pick<CourseAnalysis, 'distanceKm' | 'ascentM'>, ftp: number, riderKg: number): number {
  return estimateMinutes(course.distanceKm, course.ascentM ?? 0, (ftp * EVENT_PACE_FTP) / riderKg);
}
