import type { Collections, JobDoc } from '../collections';

/**
 * Jobs and locks (DECISIONS #56). Every write that changes who runs something is one atomic
 * `findOneAndUpdate`/`updateOne` guarded by the lease, so two processes can never both think they
 * hold it.
 */

export const jobId = (kind: string, key: string) => `${kind}:${key}`;

/** Free: never locked, or the holder's lease ran out. */
const free = (now: Date) => ({ $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }] });

/** Create the job if it's missing. An existing job keeps its schedule (a restart doesn't re-run everything). */
export async function ensureJob(c: Collections, kind: string, key: string, runAt: Date, now: Date): Promise<void> {
  await c.jobs.updateOne(
    { _id: jobId(kind, key) },
    { $setOnInsert: { kind, key, runAt, attempts: 0 }, $set: { updatedAt: now } },
    { upsert: true },
  );
}

/**
 * Make the job due by `at` (creating it if needed). `$min`, so a burst of kicks is one run at the
 * first one's time, and a kick never delays a run. A run already holding the job isn't disturbed: it
 * may have read its data before this kick, so `rerunAt` survives into its release (DECISIONS #64).
 */
export async function kickJob(c: Collections, kind: string, key: string, now: Date, at: Date = now): Promise<void> {
  await c.jobs.updateOne(
    { _id: jobId(kind, key) },
    { $setOnInsert: { kind, key, attempts: 0 }, $min: { runAt: at, rerunAt: at }, $set: { updatedAt: now } },
    { upsert: true },
  );
}

export async function removeJob(c: Collections, kind: string, key: string): Promise<void> {
  await c.jobs.deleteOne({ _id: jobId(kind, key) });
}

export async function getJob(c: Collections, kind: string, key: string): Promise<JobDoc | null> {
  return c.jobs.findOne({ _id: jobId(kind, key) });
}

/** The earliest due, unheld job of these kinds, now leased to `owner`. */
export async function claimDueJob(c: Collections, kinds: string[], owner: string, now: Date, leaseMs: number): Promise<JobDoc | null> {
  return c.jobs.findOneAndUpdate(
    { kind: { $in: kinds }, runAt: { $lte: now }, ...free(now) },
    { $set: { lockedBy: owner, lockedUntil: new Date(now.getTime() + leaseMs), updatedAt: now }, $unset: { rerunAt: '' } },
    { sort: { runAt: 1 }, returnDocument: 'after' },
  );
}

/**
 * Lease this job (or lock) to `owner` whether it's due or not — a manual run, or taking a lock.
 * Creates it if missing. Null when someone else holds it.
 */
export async function claimJob(c: Collections, kind: string, key: string, owner: string, now: Date, leaseMs: number): Promise<JobDoc | null> {
  const lease = { lockedBy: owner, lockedUntil: new Date(now.getTime() + leaseMs), updatedAt: now };
  try {
    return await c.jobs.findOneAndUpdate(
      { _id: jobId(kind, key), ...free(now) },
      { $set: lease, $unset: { rerunAt: '' }, $setOnInsert: { kind, key, runAt: now, attempts: 0 } },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (err) {
    // The job exists and is held: the filter missed, so the upsert tried to insert a duplicate _id.
    if ((err as { code?: number }).code === 11000) return null;
    throw err;
  }
}

/** Keep holding it. False when the lease was lost (it ran out and someone else took it). */
export async function extendLease(c: Collections, id: string, owner: string, now: Date, leaseMs: number): Promise<boolean> {
  const r = await c.jobs.updateOne({ _id: id, lockedBy: owner }, { $set: { lockedUntil: new Date(now.getTime() + leaseMs), updatedAt: now } });
  return r.matchedCount === 1;
}

/**
 * Let go of it. `next` reschedules (a job), or sooner if a kick arrived during the run; `null` deletes
 * it (a one-off that's done); `undefined` just unlocks (a lock). Only the holder can do this.
 */
export async function releaseJob(
  c: Collections,
  id: string,
  owner: string,
  now: Date,
  outcome: { next?: Date | null; error?: string } = {},
): Promise<void> {
  const mine = { _id: id, lockedBy: owner };
  if (outcome.next === null) {
    await c.jobs.deleteOne(mine);
    return;
  }
  const unlock = { lockedBy: '', lockedUntil: '' } as const;
  if (!outcome.next) {
    await c.jobs.updateOne(mine, { $unset: unlock, $set: { updatedAt: now } });
  } else {
    // A pipeline, so the new time can read `rerunAt`. `$min` skips a missing field.
    const runAt = { $min: [outcome.next, '$rerunAt'] };
    const fields = ['lockedBy', 'lockedUntil', 'rerunAt'];
    await c.jobs.updateOne(
      mine,
      outcome.error
        ? [
            { $set: { runAt, lastRunAt: now, lastError: { $literal: outcome.error }, attempts: { $add: ['$attempts', 1] }, updatedAt: now } },
            { $unset: fields },
          ]
        : [{ $set: { runAt, lastRunAt: now, attempts: 0, updatedAt: now } }, { $unset: [...fields, 'lastError'] }],
    );
  }
}

/** On shutdown: hand back everything this process holds, so another can pick it up at once. */
export async function releaseAllJobs(c: Collections, owner: string, now: Date): Promise<void> {
  await c.jobs.updateMany({ lockedBy: owner }, { $unset: { lockedBy: '', lockedUntil: '' }, $set: { updatedAt: now } });
}
