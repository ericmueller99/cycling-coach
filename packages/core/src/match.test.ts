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

describe('matchActivities', () => {
  it('matches the race, not the warm-up spin before it', () => {
    const result = matchActivities(
      [ev('e1', '2026-10-27', 'race', 40)],
      [
        ride('warmup', '2026-10-27T16:56:27', "Zwift - California Dreamin' in Watopia", 27),
        ride('race', '2026-10-27T17:32:13', 'Zwift - Race: Zwift Racing League - Race 5 (B)', 42),
      ],
    );
    expect(result).toEqual([{ eventId: 'e1', activityId: 'race' }]);
  });

  it('matches a structured workout to an intervals day', () => {
    expect(
      matchActivities([ev('e1', '2026-10-28', 'intervals', 63)], [ride('a', '2026-10-28T11:50:26', 'Zwift - VO2 6x3', 63)]),
    ).toEqual([{ eventId: 'e1', activityId: 'a' }]);
  });

  it('never pairs a session with a ride it was unlinked from', () => {
    const unlinked = { ...ev('e1', '2026-10-28', 'intervals', 63), intervalsEventId: 77, ignoredActivityIds: ['a'] };
    expect(matchActivities([unlinked], [{ ...ride('a', '2026-10-28T11:50:26', 'Zwift - VO2 6x3', 63), pairedEventId: 77 }])).toEqual([]);
    expect(
      matchActivities([unlinked], [ride('a', '2026-10-28T11:50:26', 'Zwift - VO2 6x3', 63), ride('b', '2026-10-28T18:00:00', 'Zwift - VO2 6x3', 63)]),
    ).toEqual([{ eventId: 'e1', activityId: 'b' }]);
  });

  it("trusts intervals.icu's pairing over scoring", () => {
    const events = [{ ...ev('e1', '2026-10-28', 'intervals', 60), intervalsEventId: 77 }];
    // Name and duration would score badly; the pairing decides.
    expect(matchActivities(events, [{ ...ride('a', '2026-10-28T11:50:26', 'Evening spin', 20), pairedEventId: 77 }])).toEqual([
      { eventId: 'e1', activityId: 'a' },
    ]);
  });

  it('lets a late upload un-miss a session', () => {
    const events = [{ ...ev('e1', '2026-10-28', 'endurance', 60), status: 'missed' as const }];
    expect(matchActivities(events, [ride('a', '2026-10-28T08:00:00', 'Morning ride', 60, 'Ride')])).toEqual([
      { eventId: 'e1', activityId: 'a' },
    ]);
  });

  it("doesn't tick off a recovery day with a race", () => {
    expect(matchActivities([ev('e1', '2026-10-29', 'recovery', 30)], [ride('a', '2026-10-29T18:00:00', 'Club Ladder race', 35)])).toEqual([]);
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
    expect(matchActivities(events, activities)).toEqual([]);
  });

  it('never matches a ride the athlete grouped into another session', () => {
    const events: MatchableEvent[] = [
      { ...ev('z2', '2026-11-01', 'endurance', 120), status: 'done', activityId: 'long', extraActivityIds: ['loop'] },
      ev('spin', '2026-11-01', 'recovery', 30),
    ];
    const activities = [ride('long', '2026-11-01T09:00:00', 'Long Z2', 84), ride('loop', '2026-11-01T10:30:00', 'Beach Island Loop', 27)];
    expect(matchActivities(events, activities)).toEqual([]);
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
