import { describe, expect, it } from 'vitest';
import { coachEvents, describeEventInfo, eventStats, formatHoursMinutes, formatLongDate, isEventSession, parseDurationText, untilText } from './event-info';

describe('event details (DECISIONS #98)', () => {
  it('tells an event from a Zwift race', () => {
    expect(isEventSession({ kind: 'race', platform: 'garmin', eventInfo: { type: 'gran_fondo' } })).toBe(true);
    expect(isEventSession({ kind: 'race', platform: 'garmin' })).toBe(true); // imported outdoor race, no details yet
    expect(isEventSession({ kind: 'race', platform: 'zwift' })).toBe(false);
    expect(isEventSession({ kind: 'ride', platform: 'garmin' })).toBe(false);
  });

  it('describes what it knows', () => {
    expect(describeEventInfo({ type: 'gran_fondo', distanceKm: 142, ascentM: 2350 })).toBe('Gran fondo · 142 km · 2,350 m');
    expect(describeEventInfo({ type: 'criterium', distanceKm: 40.25 })).toBe('Crit · 40.3 km');
    expect(eventStats({ ascentM: 0 })).toBe('');
    expect(eventStats(undefined)).toBe('');
  });

  it('reads a typed time the ways people write it', () => {
    for (const t of ['~5 h 30', '5h30', '5:30', '5.5 h', '5 hours 30', '330 min', '330m', '330']) expect(parseDurationText(t)).toBe(330);
    expect(parseDurationText('5')).toBe(300);
    expect(parseDurationText('45 min')).toBe(45);
    expect(parseDurationText('soon')).toBeNull();
    expect(parseDurationText('')).toBeNull();
  });

  it('writes it back', () => {
    expect(formatHoursMinutes(330)).toBe('5 h 30');
    expect(formatHoursMinutes(305)).toBe('5 h 05');
    expect(formatHoursMinutes(300)).toBe('5 h');
    expect(formatHoursMinutes(45)).toBe('45 min');
  });
});

describe('the events the coach keeps in view (DECISIONS #101)', () => {
  const e = (id: string, date: string, over: object = {}) => ({ id, date, kind: 'race', platform: 'zwift', status: 'planned', ...over }) as const;
  it('takes real events, races with a goal and A races, in date order', () => {
    const events = [
      e('fondo', '2027-09-11', { platform: 'garmin', eventInfo: { type: 'gran_fondo' } }),
      e('zrl', '2026-11-10', { priority: 'C' }),
      e('goal', '2026-12-01', { priority: 'B' }),
      e('a', '2026-11-20', { priority: 'A' }),
      e('skipped', '2026-11-12', { platform: 'garmin', status: 'skipped' }),
      { ...e('ride', '2026-11-13'), kind: 'ride' },
    ] as never[];
    expect(coachEvents(events, [{ eventId: 'goal' }]).map((x: { id: string }) => x.id)).toEqual(['a', 'goal', 'fondo']);
  });

  it('says how far off a day is', () => {
    expect(untilText('2027-09-11', '2026-11-07')).toBe('in 44 weeks');
    expect(untilText('2026-11-17', '2026-11-07')).toBe('in 10 days');
    expect(untilText('2026-11-01', '2026-11-07')).toBe('');
    expect(formatLongDate('2027-09-11')).toBe('Sat Sep 11 2027');
  });
});
