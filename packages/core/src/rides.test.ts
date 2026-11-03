import type { Activity } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { canAddRide, combineRides, sessionRideIds } from './rides';

const ride = (id: string, min: number, extra: Partial<Activity> = {}): Activity => ({
  id,
  name: id,
  type: 'VirtualRide',
  startLocal: '2026-11-01T09:00:00',
  distanceM: min * 500,
  movingSec: min * 60,
  elapsedSec: min * 60,
  ...extra,
});

describe('sessionRideIds', () => {
  it('lists the matched ride first, then grouped ones', () => {
    expect(sessionRideIds({ activityId: 'a', extraActivityIds: ['b', 'c'] })).toEqual(['a', 'b', 'c']);
    expect(sessionRideIds({})).toEqual([]);
  });
});

describe('combineRides', () => {
  it('adds up time, distance and load, and weights power by time', () => {
    const t = combineRides([
      ride('long', 84, { trainingLoad: 78, avgWatts: 220, normalizedWatts: 230, ftp: 345 }),
      ride('loop', 27, { trainingLoad: 20, avgWatts: 200, normalizedWatts: 205, ftp: 345 }),
    ]);
    expect(t).toMatchObject({ count: 2, movingSec: 111 * 60, distanceM: 111 * 500, trainingLoad: 98 });
    expect(t.avgWatts).toBe(Math.round((220 * 84 + 200 * 27) / 111));
    // Fourth-power mean sits a little above the plain time-weighted mean (223.9).
    expect(t.normalizedWatts).toBe(225);
    expect(t.intensityPct).toBe(Math.round((225 / 345) * 100));
  });

  it('keeps a single ride as it is', () => {
    expect(combineRides([ride('a', 60, { trainingLoad: 50, normalizedWatts: 250, intensityPct: 72 })])).toMatchObject({
      count: 1,
      trainingLoad: 50,
      normalizedWatts: 250,
      intensityPct: 72,
    });
  });

  it('leaves power out when no ride has any', () => {
    expect(combineRides([ride('a', 30), ride('b', 30)])).toMatchObject({ trainingLoad: undefined, avgWatts: undefined, normalizedWatts: undefined });
  });
});

describe('canAddRide', () => {
  const session = { date: '2026-11-01', status: 'done' as const, activityId: 'long' };
  it('takes another ride from the same day', () => {
    expect(canAddRide(session, ride('loop', 27))).toEqual({ ok: true });
    expect(canAddRide({ date: '2026-11-01', status: 'missed' }, ride('loop', 27))).toEqual({ ok: true });
  });
  it('refuses other days, runs, skipped sessions and rides already in it', () => {
    expect(canAddRide(session, ride('loop', 27, { startLocal: '2026-10-31T09:00:00' })).ok).toBe(false);
    expect(canAddRide(session, ride('run', 27, { type: 'Run' })).ok).toBe(false);
    expect(canAddRide({ ...session, status: 'skipped' }, ride('loop', 27)).ok).toBe(false);
    expect(canAddRide(session, ride('long', 84)).ok).toBe(false);
    expect(canAddRide({ ...session, extraActivityIds: ['loop'] }, ride('loop', 27)).ok).toBe(false);
  });
});
