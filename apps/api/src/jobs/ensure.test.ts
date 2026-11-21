import { collections, ensureIndexes, getJob, type Collections } from '@cycling-coach/db';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DAILY_WALK_WINDOW, ensureUserJobs, JOB, registerJobs, type JobDeps } from './index';
import { JobRunner } from './runner';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('ensure_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await c.jobs.deleteMany({});
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';

describe('ensureUserJobs (DECISIONS #60)', () => {
  it("follows one athlete's connections: jobs appear when connected and go when not", async () => {
    const jobs = new JobRunner(c, { owner: 't', jitter: () => 0, log: () => {} })
      .register(JOB.delta, { every: 15 * 60_000, run: async () => {} })
      .register(JOB.zwiftMetrics, { every: 6 * 3_600_000, run: async () => {} })
      .register(JOB.zwiftExtended, { every: 24 * 3_600_000, run: async () => {} });
    const state = { intervals: true, zwift: false };
    const deps = { c, now: () => new Date('2026-11-20T20:00:00Z'), random: () => 0, sync: { connected: async () => state.intervals }, zwiftSync: { connected: async () => state.zwift } };

    expect(await ensureUserJobs(jobs, deps as never, U)).toEqual({ intervals: true, zwift: false });
    expect(await getJob(c, JOB.delta, U)).not.toBeNull();
    expect(await getJob(c, JOB.zwiftMetrics, U)).toBeNull();

    state.intervals = false;
    state.zwift = true;
    await ensureUserJobs(jobs, deps as never, U);
    expect(await getJob(c, JOB.delta, U)).toBeNull();
    expect(await getJob(c, JOB.zwiftMetrics, U)).not.toBeNull();
    // First run: the next morning window (no profile → UTC), never right away.
    expect((await getJob(c, JOB.zwiftExtended, U))?.runAt.toISOString()).toBe('2026-11-21T04:00:00.000Z');

    // The deployment can leave the walk to the button (DECISIONS #116).
    await ensureUserJobs(jobs, { ...deps, zwiftDailyEvents: false } as never, U);
    expect(await getJob(c, JOB.zwiftMetrics, U)).not.toBeNull();
    expect(await getJob(c, JOB.zwiftExtended, U)).toBeNull();
  });
});

describe('the daily events walk (DECISIONS #116)', () => {
  const now = new Date('2026-11-20T20:00:00Z'); // 15:00 in New York
  async function runOnce(dailyWalk: () => Promise<string>) {
    await c.profiles.deleteMany({});
    await c.profiles.insertOne({ userId: U, timezone: 'America/New_York' } as never);
    const lines: string[] = [];
    const deps = { c, zwiftEvents: { dailyWalk }, now: () => now, random: () => 0.5, log: (l: string) => lines.push(l) } as unknown as JobDeps;
    const jobs = registerJobs(new JobRunner(c, { owner: 't', jitter: () => 0, now: () => now, log: () => {} }), deps);
    await jobs.kick(JOB.zwiftExtended, U);
    await jobs.tick();
    await jobs.idle();
    return { job: await getJob(c, JOB.zwiftExtended, U), lines };
  }

  it('next runs tomorrow inside the early-morning window, local time', async () => {
    const { job } = await runOnce(async () => 'ran');
    expect(DAILY_WALK_WINDOW).toEqual({ windowStart: '04:00', windowEnd: '07:00' });
    expect(job?.runAt.toISOString()).toBe('2026-11-21T10:30:00.000Z'); // 05:30 EST
    expect(job?.attempts ?? 0).toBe(0);
  });

  it('a failed or crashed walk waits for tomorrow, never a retry', async () => {
    for (const walk of [async () => 'failed', async () => Promise.reject(new Error('boom'))]) {
      const { job, lines } = await runOnce(walk);
      expect(job?.runAt.toISOString()).toBe('2026-11-21T10:30:00.000Z');
      expect(job?.lastError).toBeUndefined();
      expect(lines.join('\n')).toMatch(/daily walk (failed|crashed)/);
    }
  });
});
