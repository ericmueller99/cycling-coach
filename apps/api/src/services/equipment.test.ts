import { collections, ensureIndexes, rideBikesFor, saveActivities, type Collections } from '@cycling-coach/db';
import type { Activity, BikeInput } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBike, changeBike, chooseRideBike, dueChains, equipment, markWaxed, removeBike } from './equipment';
import { settleRides } from './rides';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('equipment_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-11-10T12:00:00Z');
const TODAY = '2026-11-10';

const ride = (id: string, day: string, km: number, over: Partial<Activity> = {}): Activity => ({
  id,
  name: id,
  type: 'Ride',
  startLocal: `${day}T09:00:00`,
  distanceM: km * 1000,
  movingSec: 3600,
  elapsedSec: 3600,
  ...over,
});
const zwift = (id: string, day: string, km: number) => ride(id, day, km, { type: 'VirtualRide', source: 'ZWIFT' });

const waxed = (name: string, over: Partial<BikeInput> = {}): BikeInput => ({
  name,
  chain: { type: 'waxed', rewaxKm: 300, lastWaxedAt: '2026-11-01T23:59' },
  ...over,
});

const bikeOf = async (id: string) => (await rideBikesFor(c, U, [id])).get(id);

beforeEach(async () => {
  await Promise.all([c.activities.deleteMany({}), c.bikes.deleteMany({}), c.rideBikes.deleteMany({}), c.calendarEvents.deleteMany({}), c.profiles.deleteMany({})]);
  await c.profiles.insertOne({ userId: U, timezone: 'UTC' } as never);
});

describe('default bikes (DECISIONS #114)', () => {
  it('backfills unassigned rides of its kind when a default is set, and leaves the rest', async () => {
    await saveActivities(c, U, [ride('out1', '2026-10-01', 50), zwift('in1', '2026-10-02', 30), ride('run', '2026-10-03', 10, { type: 'Run' })], NOW);
    const road = await addBike(c, U, waxed('Road', { defaultFor: 'outdoor' }), NOW);
    expect(await bikeOf('out1')).toBe(road.id);
    expect(await bikeOf('in1')).toBeUndefined();
    expect(await bikeOf('run')).toBeUndefined();

    const trainer = await addBike(c, U, waxed('Trainer'), NOW);
    await changeBike(c, U, trainer.id, { defaultFor: 'indoor' }, NOW);
    expect(await bikeOf('in1')).toBe(trainer.id);
  });

  it('keeps one default per kind, and a new default never moves a ride that has a bike', async () => {
    await saveActivities(c, U, [ride('out1', '2026-10-01', 50)], NOW);
    const road = await addBike(c, U, waxed('Road', { defaultFor: 'outdoor' }), NOW);
    const gravel = await addBike(c, U, waxed('Gravel', { defaultFor: 'outdoor' }), NOW);
    const { bikes } = await equipment(c, U, TODAY);
    expect(bikes.find((b) => b.id === road.id)?.defaultFor).toBeUndefined();
    expect(bikes.find((b) => b.id === gravel.id)?.defaultFor).toBe('outdoor');
    expect(await bikeOf('out1')).toBe(road.id);
  });

  it('gives new rides the default when they settle, but not over the rider’s choice', async () => {
    const road = await addBike(c, U, waxed('Road', { defaultFor: 'outdoor' }), NOW);
    const gravel = await addBike(c, U, waxed('Gravel'), NOW);
    await saveActivities(c, U, [ride('new1', '2026-11-08', 40), ride('new2', '2026-11-09', 60)], NOW);
    expect(await chooseRideBike(c, U, 'new2', gravel.id, NOW)).toBeNull();
    await settleRides(c, U, '2026-10-20', TODAY, NOW);
    expect(await bikeOf('new1')).toBe(road.id);
    expect(await bikeOf('new2')).toBe(gravel.id);
  });

  it('moves a bike to the intervals.icu twin when a provider copy is dropped', async () => {
    const gravel = await addBike(c, U, waxed('Gravel'), NOW);
    await saveActivities(c, U, [ride('garmin:1', '2026-11-08', 40, { provider: 'garmin' })], NOW);
    await chooseRideBike(c, U, 'garmin:1', gravel.id, NOW);
    await saveActivities(c, U, [ride('i1', '2026-11-08', 40)], NOW);
    await settleRides(c, U, '2026-10-20', TODAY, NOW);
    expect(await bikeOf('i1')).toBe(gravel.id);
    expect(await bikeOf('garmin:1')).toBeUndefined();
  });

  it('refuses a bike on a run, or a bike that isn’t there', async () => {
    await saveActivities(c, U, [ride('run', '2026-11-08', 10, { type: 'Run' }), ride('r', '2026-11-08', 10)], NOW);
    expect(await chooseRideBike(c, U, 'run', null, NOW)).toMatchObject({ status: 400 });
    expect(await chooseRideBike(c, U, 'r', 'cccccccccccccccccccccccc', NOW)).toMatchObject({ status: 404 });
    expect(await chooseRideBike(c, U, 'nope', null, NOW)).toMatchObject({ status: 404 });
  });
});

describe('chain wear', () => {
  it('counts rides since the wax, alerts at the interval, and resets on a re-wax', async () => {
    await saveActivities(c, U, [ride('before', '2026-11-01', 500), ride('a', '2026-11-03', 200), ride('b', '2026-11-05', 120)], NOW);
    const road = await addBike(c, U, waxed('Road', { defaultFor: 'outdoor' }), NOW);
    const { bikes } = await equipment(c, U, TODAY);
    expect(bikes[0]).toMatchObject({ km: 820, rides: 3, wear: { km: 320, rides: 2, due: true } });
    expect(await dueChains(c, U, TODAY)).toEqual([{ bikeId: road.id, name: 'Road', km: 320, rewaxKm: 300, lastWaxedAt: '2026-11-01T23:59' }]);

    const after = await markWaxed(c, U, road.id, undefined, NOW);
    expect(after).toMatchObject({ chain: { lastWaxedAt: '2026-11-10T12:00' }, waxes: [{ at: '2026-11-10T12:00', km: 320 }] });
    expect(await dueChains(c, U, TODAY)).toEqual([]);
    expect((await equipment(c, U, TODAY)).bikes[0]?.wear).toMatchObject({ km: 0, rides: 0 });
  });

  it('refuses a re-wax on a lubed chain', async () => {
    const bike = await addBike(c, U, { name: 'Commuter', chain: { type: 'lubed' } }, NOW);
    expect(await markWaxed(c, U, bike.id, undefined, NOW)).toMatchObject({ status: 400 });
  });

  it('counts recent rides with no bike, and a deleted bike’s rides stay off the default', async () => {
    await saveActivities(c, U, [ride('a', '2026-11-03', 40), zwift('z', '2026-11-04', 25)], NOW);
    const road = await addBike(c, U, waxed('Road', { defaultFor: 'outdoor' }), NOW);
    expect((await equipment(c, U, TODAY)).unassigned).toEqual({ rides: 1, km: 25 });

    await addBike(c, U, waxed('Other'), NOW);
    expect(await removeBike(c, U, road.id, NOW)).toBe(true);
    expect(await bikeOf('a')).toBeNull();
    await settleRides(c, U, '2026-10-20', TODAY, NOW);
    expect(await bikeOf('a')).toBeNull();
  });
});
