import type { CalendarEvent } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import type { RemoteEvent } from '../providers/intervals-icu/map';
import { reconcile } from './calendar-reconcile';

const local = (id: string, link?: Partial<NonNullable<CalendarEvent['intervals']>>): CalendarEvent => ({
  id,
  date: '2026-11-05',
  kind: 'workout',
  platform: 'zwift',
  type: 'intervals',
  title: 'VO2 6x3',
  workoutId: 'w1',
  tentative: false,
  status: 'planned',
  source: 'coach',
  ...(link ? { intervals: { eventId: 1, remoteUpdated: '2026-10-30T10:00:00Z', ...link } } : {}),
});

const remote = (id: number, extra: Partial<RemoteEvent> = {}): RemoteEvent => ({
  id,
  date: '2026-11-05',
  kind: 'workout',
  platform: 'zwift',
  name: 'VO2 6x3',
  updated: '2026-10-30T10:00:00Z',
  ...extra,
});

describe('reconcile', () => {
  it('imports workouts and races created in intervals.icu', () => {
    expect(reconcile([], [remote(9, { uid: 'abc' })])).toEqual([{ type: 'import', remote: remote(9, { uid: 'abc' }) }]);
  });

  it('ignores the echo of our own last push', () => {
    expect(reconcile([local('a', { eventId: 1 })], [remote(1)])).toEqual([]);
  });

  it('applies an edit made in intervals.icu', () => {
    const r = remote(1, { date: '2026-11-06', updated: '2026-10-31T08:00:00Z' });
    expect(reconcile([local('a', { eventId: 1 })], [r])).toEqual([{ type: 'update', local: local('a', { eventId: 1 }), remote: r }]);
  });

  it('removes locally what was deleted in intervals.icu', () => {
    expect(reconcile([local('a', { eventId: 1 })], [])).toEqual([{ type: 'remove-local', local: local('a', { eventId: 1 }) }]);
  });

  it('lets an unpushed local change win over both remote edits and remote deletes', () => {
    const pending = local('a', { eventId: 1, error: 'intervals.icu unreachable' });
    expect(reconcile([pending], [remote(1, { updated: '2026-11-01T00:00:00Z' })])).toEqual([]);
    expect(reconcile([pending], [])).toEqual([]);
  });

  it("adopts our own create whose response was lost, instead of importing a duplicate", () => {
    const unlinked = local('a');
    const r = remote(5, { uid: 'f00-server-assigned', externalId: 'cycling-coach:a' });
    expect(reconcile([unlinked], [r])).toEqual([{ type: 'adopt', local: unlinked, remote: r }]);
  });

  it('never imports a copy of one of ours, even when the session is out of the window', () => {
    expect(reconcile([], [remote(6, { externalId: 'cycling-coach:gone' })])).toEqual([]);
  });

  it('leaves local-only rides alone', () => {
    const ride: CalendarEvent = { ...local('z'), kind: 'ride', type: 'endurance', workoutId: undefined } as CalendarEvent;
    expect(reconcile([ride], [])).toEqual([]);
  });
});
