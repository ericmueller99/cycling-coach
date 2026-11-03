import { collections, ensureIndexes, getJob, jobId, releaseJob, claimJob, type Collections } from '@cycling-coach/db';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobBusyError, JobRunner } from './runner';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('jobs_test');
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

/** A clock tests move by hand. */
function clock(start = Date.parse('2026-11-03T00:00:00Z')) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

const runner = (owner: string, now: () => Date, opts: { leaseMs?: number; concurrency?: number } = {}) =>
  new JobRunner(c, { owner, now, jitter: () => 0, pollMs: 10, log: () => {}, ...opts });

describe('job leases (two processes, one database)', () => {
  it('a due job is claimed by exactly one runner', async () => {
    const t = clock();
    let runs = 0;
    const def = { every: 60_000, run: async () => void runs++ };
    const a = runner('a', t.now).register('test', def);
    const b = runner('b', t.now).register('test', def);
    await a.schedule('test', 'k');
    await Promise.all([a.tick(), b.tick()]);
    await Promise.all([a.idle(), b.idle()]);
    await Promise.all([a.stop(0), b.stop(0)]);
    expect(runs).toBe(1);
    const job = await getJob(c, 'test', 'k');
    expect(job?.lockedBy).toBeUndefined();
    expect(job?.runAt.getTime()).toBe(t.now().getTime() + 60_000);
  });

  it("a crashed holder's job is free once its lease runs out", async () => {
    const t = clock();
    expect(await claimJob(c, 'test', 'k', 'dead', t.now(), 1_000)).not.toBeNull();
    expect(await claimJob(c, 'test', 'k', 'b', t.now(), 1_000)).toBeNull();
    t.advance(1_001);
    expect((await claimJob(c, 'test', 'k', 'b', t.now(), 1_000))?.lockedBy).toBe('b');
  });

  it('only the holder can release', async () => {
    const t = clock();
    await claimJob(c, 'test', 'k', 'a', t.now(), 60_000);
    await releaseJob(c, jobId('test', 'k'), 'b', t.now(), { next: t.now() });
    expect((await getJob(c, 'test', 'k'))?.lockedBy).toBe('a');
  });

  it('schedule keeps an existing time; a new job falls due now (no jitter)', async () => {
    const t = clock();
    const a = runner('a', t.now).register('test', { every: 60_000, run: async () => {} });
    await a.schedule('test', 'k');
    const first = (await getJob(c, 'test', 'k'))!.runAt;
    t.advance(5_000);
    await a.schedule('test', 'k');
    expect((await getJob(c, 'test', 'k'))!.runAt).toEqual(first);
  });
});

describe('JobRunner outcomes', () => {
  it('a failure backs off and counts attempts; a success resets them', async () => {
    const t = clock();
    let fail = true;
    const a = runner('a', t.now).register('test', {
      every: 15 * 60_000,
      run: async () => {
        if (fail) throw new Error('boom');
      },
    });
    await a.schedule('test', 'k');
    await a.tick();
    await a.idle();
    let job = (await getJob(c, 'test', 'k'))!;
    expect(job.attempts).toBe(1);
    expect(job.lastError).toBe('boom');
    expect(job.runAt.getTime()).toBe(t.now().getTime() + 60_000);
    t.advance(60_000);
    await a.tick();
    await a.idle();
    job = (await getJob(c, 'test', 'k'))!;
    expect(job.attempts).toBe(2);
    expect(job.runAt.getTime()).toBe(t.now().getTime() + 120_000);
    fail = false;
    t.advance(120_000);
    await a.tick();
    await a.idle();
    await a.stop(0);
    job = (await getJob(c, 'test', 'k'))!;
    expect(job.attempts).toBe(0);
    expect(job.lastError).toBeUndefined();
    expect(job.runAt.getTime()).toBe(t.now().getTime() + 15 * 60_000);
  });

  it('null deletes a finished one-off; a Date reschedules to it', async () => {
    const t = clock();
    const at = new Date(t.now().getTime() + 5_000);
    const a = runner('a', t.now)
      .register('once', { every: 60_000, run: async () => null })
      .register('later', { every: 60_000, run: async () => at });
    await a.schedule('once', 'k');
    await a.schedule('later', 'k');
    await a.tick();
    await a.idle();
    await a.stop(0);
    expect(await getJob(c, 'once', 'k')).toBeNull();
    expect((await getJob(c, 'later', 'k'))!.runAt).toEqual(at);
  });

  it('stays within its concurrency', async () => {
    const t = clock();
    let running = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = runner('a', t.now, { concurrency: 2 }).register('test', {
      every: 60_000,
      run: async () => {
        peak = Math.max(peak, ++running);
        await gate;
        running--;
      },
    });
    for (const k of ['1', '2', '3', '4']) await a.schedule('test', k);
    await a.tick();
    expect(peak).toBe(2);
    release();
    await a.idle();
    await a.stop(0);
  });
});

describe('manual runs and locks', () => {
  it('runNow waits for a run held elsewhere, then reschedules a full interval out', async () => {
    const t = clock();
    const a = runner('a', t.now).register('test', { every: 60_000, run: async () => {} });
    await claimJob(c, 'test', 'k', 'other', t.now(), 60_000);
    const pending = a.runNow('test', 'k', async () => 'done', { waitMs: 60_000 });
    await new Promise((r) => setTimeout(r, 30));
    await releaseJob(c, jobId('test', 'k'), 'other', t.now());
    expect(await pending).toBe('done');
    const job = (await getJob(c, 'test', 'k'))!;
    expect(job.lockedBy).toBeUndefined();
    expect(job.runAt.getTime()).toBe(t.now().getTime() + 60_000);
  });

  it('runNow gives up with JobBusyError after waitMs', async () => {
    const t = clock();
    const a = runner('a', t.now).register('test', { every: 60_000, run: async () => {} });
    await claimJob(c, 'test', 'k', 'other', t.now(), 60_000);
    await expect(a.runNow('test', 'k', async () => 1, { waitMs: 0 })).rejects.toBeInstanceOf(JobBusyError);
  });

  it('withLock admits one holder across runners, in turn', async () => {
    const t = clock();
    const a = runner('a', t.now);
    const b = runner('b', t.now);
    const order: string[] = [];
    let inside = 0;
    const work = (name: string) => async () => {
      expect(++inside).toBe(1);
      order.push(name);
      await new Promise((r) => setTimeout(r, 20));
      inside--;
    };
    await Promise.all([a.withLock('zwift', work('a1')), b.withLock('zwift', work('b1')), a.withLock('zwift', work('a2'))]);
    expect(order.sort()).toEqual(['a1', 'a2', 'b1']);
    expect((await getJob(c, 'lock', 'zwift'))?.lockedBy).toBeUndefined();
  });

  it('trigger starts a job here unless someone holds it', async () => {
    const t = clock();
    let runs = 0;
    const a = runner('a', t.now).register('test', { every: 60_000, run: async () => void runs++ });
    expect(await a.trigger('test', 'k')).toBe(true);
    await a.idle();
    expect(runs).toBe(1);
    await claimJob(c, 'test', 'k', 'other', t.now(), 60_000);
    expect(await a.trigger('test', 'k')).toBe(false);
    expect((await getJob(c, 'test', 'k'))!.runAt).toEqual(t.now());
  });
});
