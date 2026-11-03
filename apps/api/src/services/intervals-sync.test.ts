import { collections, ensureIndexes, saveProfile, type Collections } from '@cycling-coach/db';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntervalsError, type IntervalsIcu } from '../providers/intervals-icu';
import type { CalendarService } from './calendar';
import { IntervalsSync } from './intervals-sync';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('intervals_sync_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-11-03T12:00:00Z');

beforeEach(async () => {
  await Promise.all([c.integrations.deleteMany({}), c.profiles.deleteMany({})]);
  await saveProfile(c, U, { ftpZwift: 250, weightKg: 70, weightSource: 'manual', timezone: 'UTC' }, NOW);
  // An athlete who has synced before: history imported, athlete record fresh.
  await c.integrations.insertOne({
    userId: U,
    provider: 'intervals_icu',
    lastSyncAt: new Date('2026-11-03T11:00:00Z'),
    lastFullSyncAt: new Date('2026-10-01T00:00:00Z'),
    athlete: { athleteId: 'i1', ftp: 250, at: new Date('2026-11-03T11:50:00Z') },
    curvesAt: NOW,
    updatedAt: NOW,
  });
});

/** intervals.icu with nothing new on it. */
const quiet = () => ({
  listEvents: vi.fn(async () => []),
  listActivities: vi.fn(async () => []),
  wellness: vi.fn(async () => []),
  powerCurves: vi.fn(async () => []),
  athlete: vi.fn(async () => ({ athleteId: 'i1', ftp: 260 })),
});

function syncWith(icu: Partial<Record<keyof IntervalsIcu, unknown>> | null, jobs = { full: vi.fn(), delta: vi.fn() }) {
  const integrations = { intervalsFor: async () => icu as IntervalsIcu | null };
  return new IntervalsSync(c, integrations, { eventNameSuffix: '' } as unknown as CalendarService, jobs, () => NOW);
}

describe('a rejected key or token (DECISIONS #64)', () => {
  const rejected = () => ({ ...quiet(), listEvents: vi.fn(async () => Promise.reject(new IntervalsError('intervals.icu rejected the connection', 401))) });

  it('shows as an error even after years of good syncs', async () => {
    const sync = syncWith(rejected());
    await expect(sync.run(U)).rejects.toThrow('rejected');
    expect(await sync.status(U)).toMatchObject({ status: 'error', lastError: 'intervals.icu rejected the connection' });
  });

  it('a passing failure does not', async () => {
    const sync = syncWith({ ...quiet(), listEvents: vi.fn(async () => Promise.reject(new IntervalsError('intervals.icu error 503', 503))) });
    await expect(sync.run(U)).rejects.toThrow('503');
    expect((await sync.status(U)).status).toBe('connected');
  });

  it('a successful sync clears it', async () => {
    await syncWith(rejected()).run(U).catch(() => {});
    const sync = syncWith(quiet());
    await sync.run(U);
    const status = await sync.status(U);
    expect(status.status).toBe('connected');
    expect(status.lastError).toBeUndefined();
  });

  it('new credentials clear it at once, and leave other errors alone', async () => {
    const sync = syncWith(rejected());
    await sync.run(U).catch(() => {});
    await sync.clearRejection(U);
    expect(await sync.status(U)).toMatchObject({ status: 'connected' });

    await c.integrations.updateOne({ userId: U }, { $set: { lastError: 'intervals.icu error 503', lastErrorStatus: 503 } });
    await sync.clearRejection(U);
    expect((await sync.status(U)).lastError).toBe('intervals.icu error 503');
  });
});

describe('the athlete record (DECISIONS #64)', () => {
  it('is re-read when marked stale, however recent it is, and then only hourly', async () => {
    const icu = quiet();
    const sync = syncWith(icu);
    await sync.run(U);
    expect(icu.athlete).not.toHaveBeenCalled();

    await sync.markAthleteStale(U);
    await sync.run(U);
    expect(icu.athlete).toHaveBeenCalledTimes(1);
    expect((await sync.status(U)).ftp).toBe(260);

    await sync.run(U);
    expect(icu.athlete).toHaveBeenCalledTimes(1);
  });
});

describe('a full import after disconnecting', () => {
  it('stops instead of retrying forever, and keeps its place for a reconnect', async () => {
    const fullSync = { status: 'running', phase: 'activities', done: 3, total: 0, rides: 12, startedAt: NOW.toISOString(), cursor: '2026-01-01' } as const;
    await c.integrations.updateOne({ userId: U }, { $set: { fullSync } });
    expect(await syncWith(null).fullRun(U)).toBeNull();
    expect((await c.integrations.findOne({ userId: U }))?.fullSync).toMatchObject({ status: 'running', cursor: '2026-01-01', done: 3 });
  });
});
