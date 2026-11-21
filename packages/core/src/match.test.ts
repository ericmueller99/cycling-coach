import { describe, expect, it } from 'vitest';
import { matchActivities, missedEventIds, raceDistance, type MatchableActivity, type MatchableEvent } from './match';

const ride = (id: string, startLocal: string, name: string, min: number, sportType = 'VirtualRide'): MatchableActivity => ({
  id,
  startLocal,
  name,
  sportType,
  movingSec: min * 60,
});

const ev = (id: string, date: string, type: MatchableEvent['type'], durationMin?: number): MatchableEvent => ({
  id,
  date,
  type,
  status: 'planned',
  ...(durationMin ? { durationMin } : {}),
});

/** After every date below, so the sessions' days are over unless a test says otherwise. */
const TODAY = '2026-12-01';

describe('matchActivities', () => {
  it('matches the race, not the warm-up spin before it', () => {
    const result = matchActivities(
      [ev('e1', '2026-10-27', 'race', 40)],
      [
        ride('warmup', '2026-10-27T16:56:27', "Zwift - California Dreamin' in Watopia", 27),
        ride('race', '2026-10-27T17:32:13', 'Zwift - Race: Zwift Racing League - Race 5 (B)', 42),
      ],
      TODAY,
    );
    expect(result).toEqual([{ eventId: 'e1', activityId: 'race' }]);
  });

  it('matches a structured workout to an intervals day', () => {
    expect(
      matchActivities([ev('e1', '2026-10-28', 'intervals', 63)], [ride('a', '2026-10-28T11:50:26', 'Zwift - VO2 6x3', 63)], TODAY),
    ).toEqual([{ eventId: 'e1', activityId: 'a' }]);
  });

  it('never pairs a session with a ride it was unlinked from', () => {
    const unlinked = { ...ev('e1', '2026-10-28', 'intervals', 63), intervalsEventId: 77, ignoredActivityIds: ['a'] };
    expect(matchActivities([unlinked], [{ ...ride('a', '2026-10-28T11:50:26', 'Zwift - VO2 6x3', 63), pairedEventId: 77 }], TODAY)).toEqual([]);
    expect(
      matchActivities([unlinked], [ride('a', '2026-10-28T11:50:26', 'Zwift - VO2 6x3', 63), ride('b', '2026-10-28T18:00:00', 'Zwift - VO2 6x3', 63)], TODAY),
    ).toEqual([{ eventId: 'e1', activityId: 'b' }]);
  });

  it("trusts intervals.icu's pairing over scoring", () => {
    const events = [{ ...ev('e1', '2026-10-28', 'intervals', 60), intervalsEventId: 77 }];
    // Name and duration would score badly; the pairing decides.
    expect(matchActivities(events, [{ ...ride('a', '2026-10-28T11:50:26', 'Evening spin', 20), pairedEventId: 77 }], TODAY)).toEqual([
      { eventId: 'e1', activityId: 'a' },
    ]);
  });

  describe('a race intervals.icu paired with a ride not named like one', () => {
    const race = { ...ev('e1', '2026-10-27', 'race', 40), intervalsEventId: 77 };
    const warmup = { ...ride('warmup', '2026-10-27T16:56:27', 'Zwift - Seafoam Circuit in Watopia', 22), pairedEventId: 77 };
    const raceRide = ride('race', '2026-10-27T17:32:13', 'Zwift - Race: ClubLadder Team A vs Team B', 35);

    it('takes the race ride over the paired warm-up', () => {
      expect(matchActivities([race], [warmup, raceRide], TODAY)).toEqual([{ eventId: 'e1', activityId: 'race' }]);
    });

    it('waits while the race day is going and the race has not uploaded', () => {
      expect(matchActivities([race], [warmup], '2026-10-27')).toEqual([]);
    });

    it('takes the race ride once it uploads the same day', () => {
      expect(matchActivities([race], [warmup, raceRide], '2026-10-27')).toEqual([{ eventId: 'e1', activityId: 'race' }]);
    });

    it('honours the pairing once the day is over and no ride looks like a race', () => {
      expect(matchActivities([race], [warmup], '2026-10-28')).toEqual([{ eventId: 'e1', activityId: 'warmup' }]);
    });

    it('takes a paired ride named like a race straight away', () => {
      expect(matchActivities([race], [{ ...raceRide, pairedEventId: 77 }], '2026-10-27')).toEqual([{ eventId: 'e1', activityId: 'race' }]);
    });
  });

  describe('a real-world event, told by distance (DECISIONS #98)', () => {
    const fondo = { ...ev('e1', '2026-10-31', 'race', 330), distanceKm: 142, intervalsEventId: 88 };
    const spin = { ...ride('spin', '2026-10-31T06:20:00', 'Morning Ride', 20, 'Ride'), distanceKm: 8 };
    const event = { ...ride('gf', '2026-10-31T07:01:00', 'Morning Ride', 318, 'Ride'), distanceKm: 144.6 };

    it('matches the ride of about the right length, though it is named like any ride', () => {
      expect(matchActivities([fondo], [spin, event], '2026-10-31')).toEqual([{ eventId: 'e1', activityId: 'gf' }]);
    });

    it('takes a paired ride of the right length on the day, without waiting', () => {
      expect(matchActivities([fondo], [{ ...event, pairedEventId: 88 }], '2026-10-31')).toEqual([{ eventId: 'e1', activityId: 'gf' }]);
    });

    it('still holds out when intervals.icu paired the warm-up spin', () => {
      expect(matchActivities([fondo], [{ ...spin, pairedEventId: 88 }], '2026-10-31')).toEqual([]);
    });

    it('leaves a ride far off the distance alone', () => {
      expect(matchActivities([fondo], [{ ...event, distanceKm: 60 }], '2026-10-31')).toEqual([]);
    });
  });

  describe('a Zwift race with a route, told by length (DECISIONS #117)', () => {
    // Nov 17: intervals.icu paired the warm-up workout (named after the race) with the race event.
    const londonCalling = { lapKm: 31.7, leadinKm: 0.46 };
    const race: MatchableEvent = { ...ev('race', '2026-11-17', 'race', 40), kind: 'race', intervalsEventId: 77, route: londonCalling };
    const warmupSession: MatchableEvent = { ...ev('wu', '2026-11-17', 'openers', 24), kind: 'workout', intervalsEventId: 78 };
    const warmup = { ...ride('warmup', '2026-11-17T17:10:00', 'Zwift - Intervals icu: ZRL TTT Warm-up · 24 min', 37), pairedEventId: 77, distanceKm: 21 };
    const raceRide = {
      ...ride('ttt', '2026-11-17T17:49:00', 'Zwift - TTT: Zwift Racing League 2026/27 Round 2: Team Tempo - Open Indigo League Division 2 (A)', 44),
      distanceKm: 32,
    };

    it('gives the race its race ride and the warm-up session its warm-up', () => {
      for (const today of ['2026-11-17', TODAY]) {
        expect(matchActivities([race, warmupSession], [warmup, raceRide], today)).toEqual(
          expect.arrayContaining([
            { eventId: 'race', activityId: 'ttt' },
            { eventId: 'wu', activityId: 'warmup' },
          ]),
        );
      }
    });

    it('waits on race day while only the warm-up has uploaded, though its name says ZRL', () => {
      expect(matchActivities([race], [warmup], '2026-11-17')).toEqual([]);
    });

    it('without a route, the warm-up name alone keeps it off the race', () => {
      const noRoute = { ...race, route: undefined };
      expect(matchActivities([noRoute], [warmup, raceRide], TODAY)).toEqual([{ eventId: 'race', activityId: 'ttt' }]);
    });

    it('lets length overrule a race-like name', () => {
      const shortRace = { ...ride('crit', '2026-11-17T17:49:00', 'Zwift - Race: Crit City', 20), distanceKm: 9 };
      expect(matchActivities([race], [shortRace], TODAY)).toEqual([]);
    });

    it('with laps set, rejects a ride far longer than the race', () => {
      const twoLaps = { ...race, route: { ...londonCalling, laps: 2 } };
      expect(matchActivities([twoLaps], [{ ...raceRide, distanceKm: 64 }], TODAY)).toEqual([{ eventId: 'race', activityId: 'ttt' }]);
      expect(matchActivities([{ ...twoLaps, route: { ...londonCalling, laps: 1 } }], [{ ...raceRide, distanceKm: 64 }], TODAY)).toEqual([]);
    });

    it('with no laps set, takes any ride of at least one lap', () => {
      expect(matchActivities([race], [{ ...raceRide, distanceKm: 64 }], TODAY)).toEqual([{ eventId: 'race', activityId: 'ttt' }]);
    });

    it('prefers the ride nearer the race length when two look like it', () => {
      const longWarmup = { ...ride('long', '2026-11-17T16:00:00', 'Zwift - Watopia', 44), distanceKm: 50 };
      expect(matchActivities([race], [longWarmup, raceRide], TODAY)).toEqual([{ eventId: 'race', activityId: 'ttt' }]);
    });
  });

  it('reads TTT as a race name', () => {
    const tttSession = ev('e1', '2026-11-17', 'race', 40);
    expect(matchActivities([tttSession], [ride('a', '2026-11-17T17:49:00', 'Zwift - WTRL TTT Zone 3', 44)], TODAY)).toEqual([
      { eventId: 'e1', activityId: 'a' },
    ]);
  });

  it('holds out for the race on a race session of another colour', () => {
    const race: MatchableEvent = { ...ev('e1', '2026-10-27', 'intervals', 40), kind: 'race', intervalsEventId: 77 };
    const warmup = { ...ride('warmup', '2026-10-27T16:56:27', 'Zwift - Seafoam Circuit in Watopia', 22), pairedEventId: 77 };
    const raceRide = ride('race', '2026-10-27T17:32:13', 'Zwift - Race: ClubLadder Team A vs Team B', 35);
    expect(matchActivities([race], [warmup, raceRide], TODAY)).toEqual([{ eventId: 'e1', activityId: 'race' }]);
  });

  it('lets a late upload un-miss a session', () => {
    const events = [{ ...ev('e1', '2026-10-28', 'endurance', 60), status: 'missed' as const }];
    expect(matchActivities(events, [ride('a', '2026-10-28T08:00:00', 'Morning ride', 60, 'Ride')], TODAY)).toEqual([
      { eventId: 'e1', activityId: 'a' },
    ]);
  });

  it("doesn't tick off a recovery day with a race", () => {
    expect(matchActivities([ev('e1', '2026-10-29', 'recovery', 30)], [ride('a', '2026-10-29T18:00:00', 'Club Ladder race', 35)], TODAY)).toEqual([]);
  });

  it('ignores other days, other sports, skipped events and already-matched activities', () => {
    const events: MatchableEvent[] = [
      ev('wrong-day', '2026-10-30', 'endurance', 60),
      { ...ev('skipped', '2026-10-29', 'endurance', 60), status: 'skipped' },
      { ...ev('done', '2026-10-29', 'endurance', 60), status: 'done', activityId: 'used' },
      ev('open', '2026-10-29', 'endurance', 60),
    ];
    const activities = [
      ride('used', '2026-10-29T08:00:00', 'Morning ride', 60, 'Ride'),
      ride('walk', '2026-10-29T09:00:00', 'Walk', 60, 'Walk'),
    ];
    expect(matchActivities(events, activities, TODAY)).toEqual([]);
  });

  it('never matches a ride the athlete grouped into another session', () => {
    const events: MatchableEvent[] = [
      { ...ev('z2', '2026-11-01', 'endurance', 120), status: 'done', activityId: 'long', extraActivityIds: ['loop'] },
      ev('spin', '2026-11-01', 'recovery', 30),
    ];
    const activities = [ride('long', '2026-11-01T09:00:00', 'Long Z2', 84), ride('loop', '2026-11-01T10:30:00', 'Beach Island Loop', 27)];
    expect(matchActivities(events, activities, TODAY)).toEqual([]);
  });
});

it('gives a race its length from a distance or a route', () => {
  expect(raceDistance({ distanceKm: 142 })).toEqual({ km: 142, exact: true });
  expect(raceDistance({ route: { lapKm: 10, leadinKm: 1, laps: 3 } })).toEqual({ km: 31, exact: true });
  expect(raceDistance({ route: { lapKm: 10, leadinKm: 1 } })).toEqual({ km: 11, exact: false });
  expect(raceDistance({})).toBeNull();
});

it('marks past planned sessions missed, not today or done ones', () => {
  const events: MatchableEvent[] = [
    ev('past', '2026-10-28', 'intervals'),
    ev('today', '2026-10-30', 'intervals'),
    { ...ev('done', '2026-10-27', 'race'), status: 'done', activityId: 'a' },
    { ...ev('skipped', '2026-10-26', 'endurance'), status: 'skipped' },
  ];
  expect(missedEventIds(events, '2026-10-30')).toEqual(['past']);
});
