import type { EventItem, ZwiftEventPen } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { calendarInputFor } from './events';

const pen = (extra: Partial<ZwiftEventPen> = {}): ZwiftEventPen => ({ id: 11, label: 2, name: 'B', start: '2027-01-12T18:00:00.000Z', rules: [], signedUp: 40, ...extra });

const event = (pens: ZwiftEventPen[], extra: Partial<EventItem> = {}): EventItem => ({
  id: 4242,
  name: 'Made-up Ladder Race',
  type: 'race',
  start: '2027-01-12T18:00:00.000Z',
  world: 'Watopia',
  route: 'Volcano Circuit',
  categoryEnforced: false,
  rules: [],
  tags: [],
  signedUp: 40,
  friends: 0,
  penKind: 'category',
  pens,
  unlocks: [],
  ranked: true,
  womenOnly: false,
  seenVia: 'public',
  me: { canEnter: true, myPenId: 11, enterablePenIds: [11], matchedPenIds: [], fitsZ2: false, signedUpPenIds: [] },
  ...extra,
});

describe('calendarInputFor: a Zwift race’s route (DECISIONS #102)', () => {
  it('carries the pen’s route and laps', () => {
    const input = calendarInputFor(event([pen({ routeId: 686828068, laps: 6 })]), 'UTC');
    expect(input).toMatchObject({ kind: 'race', zwiftEventId: 4242, zwiftPenId: 11, zwiftRouteId: 686828068, zwiftLaps: 6 });
  });

  it('carries the route alone for a timed pen', () => {
    const input = calendarInputFor(event([pen({ routeId: 686828068, durationMin: 30 })]), 'UTC');
    expect(input.zwiftRouteId).toBe(686828068);
    expect(input).not.toHaveProperty('zwiftLaps');
  });

  it('leaves both off a group ride, and off a pen with no route', () => {
    expect(calendarInputFor(event([pen({ routeId: 686828068, laps: 2 })], { type: 'group_ride' }), 'UTC')).not.toHaveProperty('zwiftRouteId');
    expect(calendarInputFor(event([pen()]), 'UTC')).not.toHaveProperty('zwiftRouteId');
  });
});
