import type { Activity, CalendarEvent, RideTotals } from '@cycling-coach/shared';

/** intervals.icu sport types that count as a ride. */
export const CYCLING_SPORT = /ride|cycl|bike|velomobile|handcycle/i;

/** Every ride of a session: the matched one first, then any the user grouped into it. */
export function sessionRideIds(e: Pick<CalendarEvent, 'activityId' | 'extraActivityIds'>): string[] {
  return [e.activityId, ...(e.extraActivityIds ?? [])].filter((id): id is string => !!id);
}

/**
 * Several rides as one session (DECISIONS #32). Time, distance and load add up; average power is
 * time-weighted; NP is the time-weighted fourth-power mean of each ride's NP — exact but for the
 * 30 s rolling window at each ride's edges. IF is that NP against the first ride's FTP.
 */
export function combineRides(rides: readonly Activity[]): RideTotals {
  const movingSec = rides.reduce((s, r) => s + r.movingSec, 0);
  const distanceM = rides.reduce((s, r) => s + r.distanceM, 0);
  const loads = rides.filter((r) => r.trainingLoad !== undefined);
  const trainingLoad = loads.length ? loads.reduce((s, r) => s + r.trainingLoad!, 0) : undefined;

  const weighted = (f: (r: Activity) => number | undefined, p: number) => {
    const xs = rides.filter((r) => f(r) !== undefined && r.movingSec > 0);
    const t = xs.reduce((s, r) => s + r.movingSec, 0);
    if (!xs.length || !t) return undefined;
    return Math.round((xs.reduce((s, r) => s + f(r)! ** p * r.movingSec, 0) / t) ** (1 / p));
  };
  const avgWatts = weighted((r) => r.avgWatts, 1);
  const normalizedWatts = weighted((r) => r.normalizedWatts, 4);
  const ftp = rides.find((r) => r.ftp)?.ftp;
  const intensityPct =
    rides.length === 1 ? rides[0]!.intensityPct : normalizedWatts && ftp ? Math.round((normalizedWatts / ftp) * 100) : undefined;

  return { count: rides.length, movingSec, distanceM, trainingLoad, avgWatts, normalizedWatts, intensityPct };
}

export type AddRideCheck = { ok: true } | { ok: false; reason: string };

/** Whether the user may group this ride into this session: same day, a ride, a session they didn't skip. */
export function canAddRide(
  e: Pick<CalendarEvent, 'date' | 'status' | 'activityId' | 'extraActivityIds'>,
  ride: Pick<Activity, 'id' | 'startLocal' | 'type'>,
): AddRideCheck {
  if (ride.startLocal.slice(0, 10) !== e.date) return { ok: false, reason: 'Only a ride from the same day can be added to a session.' };
  if (!CYCLING_SPORT.test(ride.type)) return { ok: false, reason: 'Only rides can be added to a session.' };
  if (e.status === 'skipped') return { ok: false, reason: 'This session was skipped.' };
  if (sessionRideIds(e).includes(ride.id)) return { ok: false, reason: 'That ride is already part of this session.' };
  return { ok: true };
}
