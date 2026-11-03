import { STARTER_WORKOUTS, buildZwo } from '@cycling-coach/core';
import { describe, expect, it } from 'vitest';
import { buildRaceEvent, buildWorkoutEvent, mapActivity, mapCurvePoints, mapInterval, mapPowerCurves, mapRemoteEvent, mapWellnessDays, withNameSuffix, withoutNameSuffix } from './map';

// Shapes as returned by the live API on 2026-10-30 (trimmed).
const activity = {
  id: 'i100000001',
  start_date_local: '2026-10-28T11:50:26',
  type: 'VirtualRide',
  name: 'Zwift - TrainerRoad: Monadnock -2',
  source: 'ZWIFT',
  moving_time: 3619,
  elapsed_time: 3619,
  distance: 35413.2,
  icu_average_watts: 228,
  icu_weighted_avg_watts: 289,
  icu_intensity: 83.76811,
  icu_training_load: 71,
  icu_ftp: 345,
  average_heartrate: 0,
  trainer: true,
  race: false,
  description: null,
  interval_summary: ['1x 2m57s 335w', '6x 1m58s 419w'],
};

describe('mapActivity', () => {
  it('maps the fields the coach uses and drops "no data" zeros', () => {
    expect(mapActivity(activity)).toEqual({
      id: 'i100000001',
      name: 'Zwift - TrainerRoad: Monadnock -2',
      description: undefined,
      type: 'VirtualRide',
      startLocal: '2026-10-28T11:50:26',
      source: 'ZWIFT',
      isTrainer: true,
      isRace: false,
      distanceM: 35413.2,
      movingSec: 3619,
      elapsedSec: 3619,
      elevationM: undefined,
      avgWatts: 228,
      normalizedWatts: 289,
      intensityPct: 84,
      trainingLoad: 71,
      ftp: 345,
      avgHr: undefined,
      avgCadence: undefined,
      intervalSummary: ['1x 2m57s 335w', '6x 1m58s 419w'],
      pairedEventId: undefined,
    });
  });

  it('rejects rows without an id or start', () => {
    expect(mapActivity({ name: 'x' })).toBeNull();
  });

  it('drops the empty placeholders intervals.icu returns for Strava-imported activities', () => {
    expect(
      mapActivity({ id: 'i1', start_date_local: '2026-09-28T09:00:00', source: 'STRAVA', icu_athlete_id: 'i000001', _note: 'STRAVA activities are not available via the API' }),
    ).toBeNull();
  });
});

it('maps detected intervals', () => {
  expect(
    mapInterval({ type: 'WORK', label: null, moving_time: 118, average_watts: 419, weighted_average_watts: 420, intensity: 121, zone: 6, average_cadence: 92.4 }),
  ).toEqual({ type: 'WORK', label: undefined, durationSec: 118, avgWatts: 419, normalizedWatts: 420, intensityPct: 121, zone: 6, avgCadence: 92.4, avgHr: undefined });
});

describe('power curves', () => {
  const curve = { id: '90d', label: '90 days', start_date_local: '2026-08-02T00:00:00', end_date_local: '2026-10-31T00:00:00', secs: [5, 60, 300, 720, 1200], values: [1024, 579, 422, 371, 350], activity_id: ['i1', 'i2', 'i3', 'i4', 'i5'] };

  it('maps athlete curves by id to our periods', () => {
    const [c] = mapPowerCurves({ list: [curve, { ...curve, id: 's0', label: 'This season' }, { ...curve, id: 'weird' }] });
    expect(c).toMatchObject({ period: '90d', label: '90 days', start: '2026-08-02', end: '2026-10-31' });
    expect(c!.points[2]).toEqual({ durationSec: 300, watts: 422, activityId: 'i3' });
    expect(mapPowerCurves({ list: [curve, { ...curve, id: 's0' }] }).map((x) => x.period)).toEqual(['90d', 'season']);
  });

  it('reads activity curves (watts instead of values) and filters durations', () => {
    expect(mapCurvePoints({ secs: [5, 6, 60], watts: [422, 420, 419] }, [5, 60])).toEqual([
      { durationSec: 5, watts: 422 },
      { durationSec: 60, watts: 419 },
    ]);
  });
});

it('maps wellness days for storage, rounding the fitness model', () => {
  expect(mapWellnessDays([{ id: '2026-10-30', ctl: 64.512, atl: 52.093, rampRate: -3.1586, weight: null }])).toEqual([
    { date: '2026-10-30', ctl: 64.5, atl: 52.1, rampRate: -3.2 },
  ]);
});

it('builds an indoor workout event carrying our .zwo', () => {
  const workout = { ...STARTER_WORKOUTS[1]!, id: 'w1', source: 'seed' as const, createdAt: '' };
  const xml = buildZwo(workout);
  const body = buildWorkoutEvent(
    { id: 'e1', date: '2026-11-05', kind: 'workout', platform: 'zwift', type: 'intervals', title: 'VO2 6x3', tentative: false, status: 'planned', source: 'coach', coachNote: "Only if you didn't race Wednesday" },
    workout,
    xml,
  );
  expect(body).toMatchObject({
    category: 'WORKOUT',
    start_date_local: '2026-11-05T00:00:00',
    type: 'VirtualRide',
    indoor: true,
    name: 'VO2 6x3',
    moving_time: 3780,
    filename: 'vo2-6x3.zwo',
    external_id: 'cycling-coach:e1',
  });
  expect(body.description).toContain("Only if you didn't race Wednesday");
  expect(body.file_contents).toBe(xml);
});

describe('workout name suffix', () => {
  const workout = { ...STARTER_WORKOUTS[1]!, id: 'w1', source: 'seed' as const, createdAt: '' };
  const event = { id: 'e1', date: '2026-11-05', kind: 'workout', platform: 'zwift', type: 'intervals', title: 'VO2 6x3', tentative: false, status: 'planned', source: 'coach' } as const;
  const suffix = ' via example.com';

  it('tags the pushed name only when the deployment sets one', () => {
    expect(buildWorkoutEvent(event, workout, '').name).toBe('VO2 6x3');
    expect(buildWorkoutEvent(event, workout, '', suffix).name).toBe('VO2 6x3 via example.com');
  });

  it('never doubles it', () => {
    expect(withNameSuffix('VO2 6x3 via example.com', suffix)).toBe('VO2 6x3 via example.com');
  });

  it('strips only an exact trailing match from names read back', () => {
    expect(withoutNameSuffix('VO2 6x3 via example.com', suffix)).toBe('VO2 6x3');
    expect(withoutNameSuffix('VO2 6x3', suffix)).toBe('VO2 6x3');
    expect(withoutNameSuffix('Ride via example.com and back', suffix)).toBe('Ride via example.com and back');
    expect(withoutNameSuffix('VO2 6x3 via example.org', suffix)).toBe('VO2 6x3 via example.org');
    expect(withoutNameSuffix(suffix, suffix)).toBe(suffix);
    expect(withoutNameSuffix('VO2 6x3 via example.com', undefined)).toBe('VO2 6x3 via example.com');
  });
});

describe('remote events', () => {
  // As seen on a real calendar: created by another tool, type Ride, not flagged indoor.
  const july = {
    id: 9001,
    start_date_local: '2026-07-10T00:00:00',
    category: 'WORKOUT',
    type: 'Ride',
    indoor: false,
    name: 'Virtual Ride: Endurance | 90min Z2',
    moving_time: 5400,
    updated: '2026-07-07T03:40:49.889+00:00',
    external_id: 'rot-76361e62',
  };

  it('imports a workout, reading Zwift from the name when the flags are missing', () => {
    expect(mapRemoteEvent(july)).toMatchObject({
      id: 9001,
      date: '2026-07-10',
      startTime: undefined,
      kind: 'workout',
      platform: 'zwift',
      name: 'Virtual Ride: Endurance | 90min Z2',
      movingSec: 5400,
      updated: '2026-07-07T03:40:49.889+00:00',
    });
  });

  it('maps races with priority and start time, and skips other categories', () => {
    expect(mapRemoteEvent({ id: 2, start_date_local: '2026-11-03T17:30:00', category: 'RACE_A', type: 'VirtualRide', name: 'ZRL Race 6' })).toMatchObject({
      kind: 'race',
      priority: 'A',
      startTime: '17:30',
      platform: 'zwift',
    });
    expect(mapRemoteEvent({ id: 3, start_date_local: '2026-05-01T00:00:00', category: 'SEASON_START', name: 'May 2026' })).toBeNull();
  });

  it('builds a race event', () => {
    expect(
      buildRaceEvent({ id: 'r1', date: '2026-10-31', kind: 'race', type: 'race', title: 'Club Ladder race', startTime: '17:30', priority: 'B', durationMin: 40, tentative: false, status: 'planned', source: 'coach' }),
    ).toEqual({
      category: 'RACE_B',
      start_date_local: '2026-10-31T17:30:00',
      type: 'VirtualRide',
      indoor: true,
      name: 'Club Ladder race',
      // Empty, not absent: an update has to clear notes removed here.
      description: '',
      moving_time: 2400,
      external_id: 'cycling-coach:r1',
    });
  });
});

it('keeps weigh-ins and drops days with nothing in them', () => {
  expect(mapWellnessDays([{ id: '2026-10-28', weight: 85.5 }, { id: '2026-10-29', weight: null }])).toEqual([{ date: '2026-10-28', weightKg: 85.5 }]);
});

describe('energy fields', () => {
  it('maps kJ and device calories on activities', () => {
    const a = mapActivity({ id: 'i1', start_date_local: '2026-10-24T09:00:00', moving_time: 7262, icu_joules: 1803456, calories: 1806 });
    expect(a).toMatchObject({ kilojoules: 1803, calories: 1806 });
  });
  it('maps daily steps, skipping days without a count', () => {
    expect(mapWellnessDays([{ id: '2026-10-24', steps: 11933 }, { id: '2026-10-25' }, { id: '2026-10-26', steps: 0 }])).toEqual([{ date: '2026-10-24', steps: 11933 }]);
  });
  it('maps activity tags for #tag search', () => {
    expect(mapActivity({ id: 'i1', start_date_local: '2026-10-24T09:00:00', moving_time: 60, tags: ['zrl', 3] })?.tags).toEqual(['zrl']);
    expect(mapActivity({ id: 'i1', start_date_local: '2026-10-24T09:00:00', moving_time: 60, tags: [] })?.tags).toBeUndefined();
  });
});
