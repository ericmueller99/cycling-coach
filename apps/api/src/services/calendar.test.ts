import type { CalendarEvent } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { normalisePatch } from './calendar';

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
});
