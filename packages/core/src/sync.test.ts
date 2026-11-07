import type { Activity } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { activityFingerprint, deltaWindow, diffActivities, fitnessDays, isSameRide, previousQuarter, quarterOf, shadowedRides, stepDays, weighInsFrom, yearWindows } from './sync';

const ride = (id: string, over: Partial<Activity> = {}): Activity => ({
  id,
  name: 'Z2',
  type: 'VirtualRide',
  startLocal: '2026-10-30T07:00:00',
  distanceM: 30000,
  movingSec: 3600,
  elapsedSec: 3700,
  ...over,
});

describe('deltaWindow', () => {
  it('re-reads a week before the last successful sync, up to today', () => {
    expect(deltaWindow('2026-11-02', '2026-11-02')).toEqual({ from: '2026-10-26', to: '2026-11-02' });
  });
  it('grows after an outage', () => {
    expect(deltaWindow('2026-09-01', '2026-11-02')).toEqual({ from: '2026-08-25', to: '2026-11-02' });
  });
  it('never starts after today (a clock or zone change)', () => {
    expect(deltaWindow('2026-11-05', '2026-11-02')).toEqual({ from: '2026-10-26', to: '2026-11-02' });
  });
  it('asks for a full import when never synced', () => {
    expect(deltaWindow(undefined, '2026-11-02')).toBeNull();
  });
});

describe('quarters', () => {
  it('finds the quarter of a date, with its last day', () => {
    expect(quarterOf('2026-11-02')).toEqual({ from: '2026-10-01', to: '2026-12-31', label: '2026 Q4' });
    expect(quarterOf('2024-02-29')).toEqual({ from: '2024-01-01', to: '2024-03-31', label: '2024 Q1' });
  });
  it('walks back across years', () => {
    expect(previousQuarter(quarterOf('2026-01-15'))).toEqual({ from: '2025-10-01', to: '2025-12-31', label: '2025 Q4' });
    expect(previousQuarter(quarterOf('2026-05-01'))).toEqual({ from: '2026-01-01', to: '2026-03-31', label: '2026 Q1' });
  });
  it('lists whole years for wellness', () => {
    expect(yearWindows(2024, 2026).map((w) => w.from)).toEqual(['2024-01-01', '2025-01-01', '2026-01-01']);
    expect(yearWindows(2027, 2026)).toEqual([]);
  });
});

describe('diffActivities', () => {
  it('writes new and changed rides, and removes rides intervals.icu no longer lists', () => {
    const same = ride('a');
    const stored = [
      { id: 'a', fingerprint: activityFingerprint(same) },
      { id: 'b', fingerprint: activityFingerprint(ride('b')) },
      { id: 'gone', fingerprint: 'x' },
    ];
    const remote = [same, ride('b', { trainingLoad: 61 }), ride('new')];
    const { changed, removed } = diffActivities(stored, remote);
    expect(changed.map((a) => a.id)).toEqual(['b', 'new']);
    expect(removed).toEqual(['gone']);
  });
  it('keeps a ride intervals.icu lists but no longer shares', () => {
    const stored = [{ id: 'hidden', fingerprint: 'x' }, { id: 'gone', fingerprint: 'y' }];
    expect(diffActivities(stored, [], ['hidden']).removed).toEqual(['gone']);
  });
  it('sees a reprocessed ride (new FTP) as changed', () => {
    expect(activityFingerprint(ride('a', { ftp: 280 }))).not.toBe(activityFingerprint(ride('a', { ftp: 285 })));
  });
});

describe('the same ride from two sources', () => {
  const at = (startLocal: string, elapsedSec = 3600) => ({ startLocal, elapsedSec });

  it('allows a little drift in start and length', () => {
    expect(isSameRide(at('2026-11-03T09:00:00'), at('2026-11-03T09:04:00', 3400))).toBe(true);
  });
  it('matches a ride with a long stop when one source counts only the riding', () => {
    expect(isSameRide(at('2026-11-03T09:00:00', 12_600), at('2026-11-03T09:00:00', 10_800))).toBe(true);
  });
  it('matches a recording started late', () => {
    expect(isSameRide(at('2026-11-03T09:00:00'), at('2026-11-03T09:08:00', 3120))).toBe(true);
  });
  it('matches a recording stopped early', () => {
    expect(isSameRide(at('2026-11-03T09:00:00'), at('2026-11-03T09:00:00', 2000))).toBe(true);
  });
  it('tells back-to-back rides apart', () => {
    expect(isSameRide(at('2026-11-03T09:00:00'), at('2026-11-03T10:05:00'))).toBe(false);
    expect(isSameRide(at('2026-11-03T09:00:00'), at('2026-11-03T10:00:00'))).toBe(false);
  });
  it('tells a short ride apart from a long recording around it', () => {
    expect(isSameRide(at('2026-11-03T09:00:00', 7200), at('2026-11-03T09:30:00', 1200))).toBe(false);
  });
  it('never matches a record with no length', () => {
    expect(isSameRide(at('2026-11-03T09:00:00', 0), at('2026-11-03T09:00:00', 0))).toBe(false);
  });

  it('finds the second-source copy, never the intervals.icu one', () => {
    const rides = [
      { id: 'i1', ...at('2026-11-03T09:00:00') },
      { id: 'garmin:1', provider: 'garmin', ...at('2026-11-03T09:01:00') },
      { id: 'garmin:2', provider: 'garmin', ...at('2026-11-03T17:00:00') },
    ];
    expect(shadowedRides(rides)).toEqual([{ id: 'garmin:1', twinId: 'i1' }]);
  });
});

describe('wellness views', () => {
  const days = [
    { date: '2026-11-01', ctl: 64.5, atl: 52.1, rampRate: 1.2, weightKg: 84.2, steps: 9000 },
    { date: '2026-11-02', steps: 3000 },
  ];
  it('splits stored wellness into fitness, steps and weigh-ins', () => {
    expect(fitnessDays(days)).toEqual([{ date: '2026-11-01', ctl: 64.5, atl: 52.1, form: 12.4, rampRate: 1.2, weightKg: 84.2 }]);
    expect(stepDays(days)).toEqual([
      { date: '2026-11-01', steps: 9000 },
      { date: '2026-11-02', steps: 3000 },
    ]);
    expect(weighInsFrom(days)).toEqual([{ date: '2026-11-01', kg: 84.2 }]);
  });
});
