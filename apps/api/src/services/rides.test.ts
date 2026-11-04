import { collections, createEvent, ensureIndexes, getEvent, listActivities, saveActivities, type Collections } from '@cycling-coach/db';
import type { Activity } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { settleRides } from './rides';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('rides_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const V = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = new Date('2026-11-03T12:00:00Z');
const DAY = '2026-11-02';
const TODAY = '2026-11-03';

const ride = (id: string, over: Partial<Activity> = {}): Activity => ({ id, name: 'Endurance', type: 'Ride', startLocal: `${DAY}T09:00:00`, distanceM: 30000, movingSec: 3600, elapsedSec: 3600, ...over });
const garmin = (id: string, over: Partial<Activity> = {}) => ride(`garmin:${id}`, { provider: 'garmin', sourceLabel: 'Garmin Edge 840', ...over });
const session = (userId = U) => createEvent(c, userId, { date: DAY, kind: 'ride', type: 'endurance', title: 'Endurance', durationMin: 60 } as never, { source: 'app' } as never, NOW);

beforeEach(async () => {
  await Promise.all([c.activities.deleteMany({}), c.calendarEvents.deleteMany({}), c.sessionFeedback.deleteMany({})]);
});

describe('settleRides', () => {
  it('ticks off a session from a second source’s ride', async () => {
    const event = await session();
    await saveActivities(c, U, [garmin('1')], NOW);
    expect(await settleRides(c, U, DAY, TODAY, NOW)).toMatchObject({ matched: 1 });
    expect(await getEvent(c, U, event.id)).toMatchObject({ status: 'done', activityId: 'garmin:1' });
  });

  it('drops a second-source ride intervals.icu also has', async () => {
    await saveActivities(c, U, [ride('i1'), garmin('1', { startLocal: `${DAY}T09:02:00` })], NOW);
    await settleRides(c, U, DAY, TODAY, NOW);
    expect((await listActivities(c, U, DAY, TODAY)).map((a) => a.id)).toEqual(['i1']);
  });

  it('keeps a second-source ride intervals.icu doesn’t have', async () => {
    await saveActivities(c, U, [ride('i1'), garmin('1', { startLocal: `${DAY}T17:00:00` })], NOW);
    await settleRides(c, U, DAY, TODAY, NOW);
    expect((await listActivities(c, U, DAY, TODAY)).map((a) => a.id).sort()).toEqual(['garmin:1', 'i1']);
  });

  it('moves a session to the surviving ride, so nothing dangles', async () => {
    const event = await session();
    await saveActivities(c, U, [garmin('1')], NOW);
    await settleRides(c, U, DAY, TODAY, NOW);
    await saveActivities(c, U, [ride('i1')], NOW);
    await settleRides(c, U, DAY, TODAY, NOW);
    expect(await getEvent(c, U, event.id)).toMatchObject({ status: 'done', activityId: 'i1' });
  });

  it('moves feedback to the surviving ride', async () => {
    await c.sessionFeedback.insertOne({ userId: U, activityId: 'garmin:1', date: DAY, title: 'Ride', rpe: 5, updatedAt: NOW } as never);
    await saveActivities(c, U, [ride('i1'), garmin('1')], NOW);
    await settleRides(c, U, DAY, TODAY, NOW);
    expect((await c.sessionFeedback.findOne({ userId: U }))?.activityId).toBe('i1');
  });

  it('only ever touches this athlete', async () => {
    await saveActivities(c, V, [garmin('1')], NOW);
    await saveActivities(c, U, [ride('i1')], NOW);
    await settleRides(c, U, DAY, TODAY, NOW);
    expect((await listActivities(c, V, DAY, TODAY)).map((a) => a.id)).toEqual(['garmin:1']);
  });
});
