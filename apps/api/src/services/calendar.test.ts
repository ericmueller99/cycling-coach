import type { CalendarEvent } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { CalendarService, normalisePatch } from './calendar';

const race: CalendarEvent = {
  id: 'e1',
  date: '2027-01-13',
  kind: 'race',
  type: 'race',
  title: 'Club Ladder',
  platform: 'garmin',
  priority: 'A',
  startTime: '18:30',
  tentative: false,
  status: 'planned',
  source: 'manual',
};

describe('a failed push (DECISIONS #75)', () => {
  const session = { id: 'x', kind: 'workout' } as unknown as CalendarEvent;
  const service = (icu: object | null, onPushFailed: (userId: string) => Promise<void>) =>
    new CalendarService({} as never, { intervalsFor: async () => icu as never }, async () => 'A Rider', () => new Date(), onPushFailed);

  it('asks for a retry, so it never waits for a slow poll', async () => {
    const failed = vi.fn(async () => {});
    // No library workout, so building the event throws.
    await service({}, failed).push('u1', session);
    expect(failed).toHaveBeenCalledWith('u1');
  });

  it('asks for nothing when there was nothing to push', async () => {
    const failed = vi.fn(async () => {});
    await service(null, failed).push('u1', session);
    await service({}, failed).push('u1', { ...session, kind: 'ride' });
    expect(failed).not.toHaveBeenCalled();
  });
});

describe('normalisePatch', () => {
  // Regression: a move (or clearing the start time) reset an A race to B and a Garmin race to Zwift.
  it('keeps the stored priority and platform when the patch leaves them out', () => {
    expect(normalisePatch(race, { date: '2027-01-14' })).toMatchObject({ date: '2027-01-14', priority: 'A', platform: 'garmin' });
    expect(normalisePatch(race, { unset: ['startTime'] })).toMatchObject({ priority: 'A', platform: 'garmin', unset: ['startTime'] });
  });

  it('takes what the patch sets', () => {
    expect(normalisePatch(race, { priority: 'C' })).toMatchObject({ priority: 'C' });
  });

  it('still fills defaults neither has', () => {
    const bare: CalendarEvent = { ...race, platform: undefined, priority: undefined } as unknown as CalendarEvent;
    expect(normalisePatch(bare, { title: 'x' })).toMatchObject({ type: 'race', platform: 'zwift', priority: 'B' });
  });

  describe('event details (DECISIONS #98)', () => {
    const fondo: CalendarEvent = { ...race, eventInfo: { type: 'gran_fondo', distanceKm: 142, ascentM: 2350 } };

    it('keeps them through a move, and takes a whole new set', () => {
      expect(normalisePatch(fondo, { date: '2027-09-12' })).not.toHaveProperty('eventInfo');
      expect(normalisePatch(fondo, { eventInfo: { type: 'gravel' } })).toMatchObject({ eventInfo: { type: 'gravel' } });
    });

    it('never puts them on anything but a race', () => {
      const workout = { ...race, kind: 'workout', type: 'intervals', eventInfo: undefined } as CalendarEvent;
      expect(normalisePatch(workout, { eventInfo: { type: 'gravel' } })).not.toHaveProperty('eventInfo');
    });

    it('clears them when a race stops being one', () => {
      expect(normalisePatch(fondo, { kind: 'ride', type: 'endurance' }).unset).toEqual(['eventInfo']);
    });
  });
});
