import { collections, ensureIndexes, getJob, type Collections } from '@cycling-coach/db';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureUserJobs, JOB } from './index';
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
      .register(JOB.zwiftMetrics, { every: 6 * 3_600_000, run: async () => {} });
    const state = { intervals: true, zwift: false };
    const deps = { sync: { connected: async () => state.intervals }, zwiftSync: { connected: async () => state.zwift } };

    expect(await ensureUserJobs(jobs, deps as never, U)).toEqual({ intervals: true, zwift: false });
    expect(await getJob(c, JOB.delta, U)).not.toBeNull();
    expect(await getJob(c, JOB.zwiftMetrics, U)).toBeNull();

    state.intervals = false;
    state.zwift = true;
    await ensureUserJobs(jobs, deps as never, U);
    expect(await getJob(c, JOB.delta, U)).toBeNull();
    expect(await getJob(c, JOB.zwiftMetrics, U)).not.toBeNull();
  });
});
