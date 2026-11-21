import { collections, ensureIndexes, listZwiftEventMarks, saveZwiftEventMarks, upsertZwiftEvents, type Collections } from '@cycling-coach/db';
import { eventQuerySchema, type ZwiftEvent } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZwiftClient } from '../providers/zwift';
import { ZwiftEventsService } from './zwift-events';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('events_daily_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.integrations.deleteMany({}), c.zwiftEventMarks.deleteMany({}), c.zwiftEvents.deleteMany({}), c.profiles.deleteMany({})]);
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const HOUR = 3_600_000;
const now = new Date('2026-11-21T10:30:00Z');

function service(zwift: Partial<ZwiftClient> | null) {
  const pub = {} as never;
  const integrations = { zwiftFor: async () => zwift as ZwiftClient | null };
  // Route table: none stored, so the walk never fetches GameDictionary.xml.
  return new ZwiftEventsService(c, pub, integrations, () => now, { daily: true }, () => {});
}

const lastWalk = (hoursAgo: number) =>
  c.integrations.insertOne({ userId: U, provider: 'zwift', extended: { lastAt: new Date(now.getTime() - hoursAgo * HOUR), pages: 60, events: 4000 } } as never);

describe('the daily walk (DECISIONS #116)', () => {
  it('walks the logged-in feed and records it like a click', async () => {
    await lastWalk(23);
    const eventFeedPage = vi.fn(async () => ({ events: [], cursor: undefined }));
    expect(await service({ eventFeedPage }).dailyWalk(U)).toBe('ran');
    expect(eventFeedPage).toHaveBeenCalledTimes(1);
    const doc = await c.integrations.findOne({ userId: U, provider: 'zwift' });
    expect(doc?.extended?.lastAt).toEqual(now);
    // The button's cooldown follows a scheduled run too, and the page knows it's daily.
    const status = await service({ eventFeedPage }).status(U);
    expect(status.extended).toMatchObject({ daily: true, nextAllowedAt: new Date(now.getTime() + 6 * HOUR).toISOString() });
  });

  it('skips the day when any walk ran in the last 20 h', async () => {
    await lastWalk(19);
    const eventFeedPage = vi.fn();
    expect(await service({ eventFeedPage }).dailyWalk(U)).toBe('skipped');
    expect(eventFeedPage).not.toHaveBeenCalled();
  });

  it('reports a failed walk instead of throwing (no retry)', async () => {
    const eventFeedPage = vi.fn(async () => Promise.reject(new Error('HTTP 500')));
    expect(await service({ eventFeedPage }).dailyWalk(U)).toBe('failed');
    expect(eventFeedPage).toHaveBeenCalledTimes(1);
    expect((await c.integrations.findOne({ userId: U, provider: 'zwift' }))?.extended?.error).toBe('HTTP 500');
  });

  it('does nothing without a Zwift login', async () => {
    expect(await service(null).dailyWalk(U)).toBe('not_configured');
  });
});

describe('Refresh sign-ups (DECISIONS #116)', () => {
  const stored = {
    id: 5000001,
    name: 'Made-up Sunday Social',
    type: 'group_ride',
    start: '2026-11-22T16:00:00.000Z',
    categoryEnforced: false,
    rules: [],
    tags: [],
    signedUp: 0,
    friends: 0,
    penKind: 'pace',
    pens: [
      { id: 7000001, label: 1, name: 'A', start: '2026-11-22T16:00:00.000Z', km: 30, rules: [], signedUp: 0 },
      { id: 7000002, label: 2, name: 'B', start: '2026-11-22T16:00:00.000Z', km: 30, rules: [], signedUp: 0 },
    ],
    unlocks: [],
    ranked: false,
    womenOnly: false,
    seenVia: 'public',
  } as unknown as ZwiftEvent;
  const list = [
    { profileId: 900001, eventSubgroupId: 7000002, eventId: 5000001, eventName: 'Made-up Sunday Social', eventStarts: '2026-11-22T16:00:26.000+0000' },
    { profileId: 900001, eventSubgroupId: 7100001, eventId: 5100001, eventName: 'Made-up Far Race', eventStarts: '2026-12-05T18:00:00.000+0000' },
    { profileId: 900002, eventSubgroupId: 7200001, eventId: 5200001, eventName: 'Someone else', eventStarts: '2026-11-23T18:00:00.000+0000' },
  ];

  it('makes the marks exactly the list, in one request', async () => {
    await c.profiles.insertOne({ userId: U, zwiftId: '900001', timezone: 'UTC' } as never);
    await upsertZwiftEvents(c, [{ event: stored, expiresAt: new Date('2026-11-23T00:00:00Z') }], now);
    // A sign-up they've since cancelled in Zwift.
    await saveZwiftEventMarks(c, U, [{ eventId: 4000001, signedUpPenIds: [1], expiresAt: new Date('2026-11-25T00:00:00Z') }]);
    const upcomingSignups = vi.fn(async () => list);
    const r = await service({ upcomingSignups }).refreshSignups(U);
    expect(upcomingSignups).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ kind: 'done', found: 2, elsewhere: [{ eventId: 5100001, name: 'Made-up Far Race', start: '2026-12-05T18:00:00.000Z' }] });
    const marks = await listZwiftEventMarks(c, U);
    expect([...marks]).toEqual(expect.arrayContaining([[5000001, [7000002]], [5100001, [7100001]]]));
    expect(marks.size).toBe(2);
    // It shows on the stored event, with the pen.
    const q = await service({ upcomingSignups }).query(U, eventQuerySchema.parse({ filters: { signedUpOnly: true, canEnter: false, upcoming: false } }));
    expect(q.items.map((e) => [e.id, e.me.signedUpPenIds])).toEqual([[5000001, [7000002]]]);
  });

  it('at most every 5 min; a failure is recorded, not retried', async () => {
    const upcomingSignups = vi.fn(async () => Promise.reject(new Error('Zwift error 500 on /api/events/upcoming')));
    expect(await service({ upcomingSignups }).refreshSignups(U)).toEqual({ kind: 'error', error: 'Zwift error 500 on /api/events/upcoming' });
    expect(await service({ upcomingSignups }).refreshSignups(U)).toEqual({ kind: 'cooldown', nextAllowedAt: new Date(now.getTime() + 5 * 60_000).toISOString() });
    expect(upcomingSignups).toHaveBeenCalledTimes(1);
    const status = await service({ upcomingSignups }).status(U);
    expect(status.extended).toMatchObject({ signupsAt: now.toISOString(), signupsAllowedAt: new Date(now.getTime() + 5 * 60_000).toISOString() });
  });

  it('needs a Zwift login', async () => {
    expect(await service(null).refreshSignups(U)).toEqual({ kind: 'not_configured' });
  });
});
