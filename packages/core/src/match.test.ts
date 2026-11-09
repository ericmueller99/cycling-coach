import { describe, expect, it } from 'vitest';
import { matchActivities, missedEventIds, type MatchableActivity, type MatchableEvent } from './match';

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

it('marks past planned sessions missed, not today or done ones', () => {
  const events: MatchableEvent[] = [
    ev('past', '2026-10-28', 'intervals'),
    ev('today', '2026-10-30', 'intervals'),
    { ...ev('done', '2026-10-27', 'race'), status: 'done', activityId: 'a' },
    { ...ev('skipped', '2026-10-26', 'endurance'), status: 'skipped' },
  ];
  expect(missedEventIds(events, '2026-10-30')).toEqual(['past']);
});
