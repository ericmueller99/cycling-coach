import type { EventItem, EventQuery, EventQueryResult } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { runTool, type CoachPorts } from './tools';

const sundayRide = {
  id: 501,
  name: 'Sunday Social',
  type: 'group_ride',
  start: '2026-11-22T17:00:00.000Z',
  world: 'Watopia',
  route: 'Volcano Flat',
  categoryEnforced: false,
  rules: [],
  tags: [],
  signedUp: 120,
  friends: 0,
  penKind: 'pace',
  pens: [
    { id: 11, label: 1, name: 'A', start: '2026-11-22T17:00:00.000Z', km: 40, ascentM: 100, rules: [], signedUp: 40, paceFrom: 3, paceTo: 3.5 },
    { id: 12, label: 2, name: 'B', start: '2026-11-22T17:00:00.000Z', km: 40, ascentM: 100, rules: [], signedUp: 80, paceFrom: 2.5, paceTo: 3 },
  ],
  unlocks: [],
  ranked: false,
  womenOnly: false,
  seenVia: 'extended',
  me: { canEnter: true, myPenId: 11, basis: 'open', enterablePenIds: [11, 12], matchedPenIds: [], fitsZ2: true, signedUpPenIds: [12] },
} as unknown as EventItem;

function setup(result: Partial<EventQueryResult>) {
  const findEvents = vi.fn(async (_q: EventQuery) => ({
    result: { items: [], total: 0, all: 900, facets: { types: {}, worlds: {} }, through: '2026-11-26T23:00:00.000Z', ...result },
    timeZone: 'America/New_York',
  }));
  return { findEvents, ctx: { toolUseId: 'u1', today: '2026-11-20', ports: { findEvents } as unknown as CoachPorts } };
}

describe('find_events reaches the whole synced range', () => {
  it('passes dates, times and sign-ups to the filters', async () => {
    const { findEvents, ctx } = setup({ items: [sundayRide], total: 1 });
    const out = await runTool('find_events', { date_from: '2026-11-22', date_to: '2026-11-22', times_of_day: ['morning'], start_after: '08:00', signed_up_only: true }, ctx);
    const f = findEvents.mock.calls[0]![0].filters;
    expect(f).toMatchObject({ dateFrom: '2026-11-22', dateTo: '2026-11-22', timesOfDay: ['morning'], from: '08:00', signedUpOnly: true, canEnter: false });
    expect(out.content).toContain('Sun, Nov 22, 12:00 · group_ride · Sunday Social');
    expect(out.content).toContain('they are signed up (pen B)');
    // The pen they signed up for, not the one we'd have picked.
    expect(out.content).toContain('zwiftEventId 501, zwiftPenId 12');
    expect(out.content).toContain('Synced events run through Thu, Nov 26.');
  });

  it('says when a date is past what is synced, so it is not mistaken for no access', async () => {
    const { ctx } = setup({});
    const out = await runTool('find_events', { date_from: '2026-11-29', date_to: '2026-11-29' }, ctx);
    expect(out.content).toContain('No events match (of 900 synced). Synced events run through Thu, Nov 26.');
    expect(out.content).toContain('2026-11-29 is past what\'s synced: they can click "Get more events"');
  });

  it('keeps "I can enter" on by default', async () => {
    const { findEvents, ctx } = setup({});
    await runTool('find_events', { day: 'tomorrow' }, ctx);
    expect(findEvents.mock.calls[0]![0].filters).toMatchObject({ day: 'tomorrow', canEnter: true, signedUpOnly: false });
  });
});
