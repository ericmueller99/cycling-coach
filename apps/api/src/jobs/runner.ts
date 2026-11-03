import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import {
  claimDueJob,
  claimJob,
  ensureJob,
  extendLease,
  jobId,
  kickJob,
  releaseAllJobs,
  releaseJob,
  removeJob,
  type Collections,
  type JobDoc,
} from '@cycling-coach/db';

/**
 * A kind of scheduled job. `run` returns when to run next: a `Date`, `null` when the job is finished
 * for good (a one-off like a full import — the document is deleted), or nothing for "again in
 * `every`".
 */
export interface JobDef {
  every: number;
  run(key: string): Promise<Date | null | void>;
}

export interface JobRunnerOptions {
  /** Identifies this process's leases. */
  owner?: string;
  /** How long a lease lasts without a heartbeat; a crashed process's jobs are free after this. */
  leaseMs?: number;
  /** How often the loop looks for due jobs, and how often a waiting claim retries. */
  pollMs?: number;
  /** Jobs this process runs at once. */
  concurrency?: number;
  now?: () => Date;
  /** Spread for new schedules, so many athletes' jobs don't all fall due together. */
  jitter?: (everyMs: number) => number;
  log?: (line: string) => void;
}

export class JobBusyError extends Error {}

const MIN_BACKOFF_MS = 60_000;

/**
 * Background work on a Mongo-leased schedule (DECISIONS #56), replacing the `setInterval` timers.
 *
 * Every job is one `jobs` document per kind and key (`intervals.delta:<userId>`): its schedule and a
 * lease. Any number of processes can run the loop; each due job is claimed by exactly one, kept with
 * a heartbeat, and rescheduled on release. Manual runs ("Sync now") take the same lease, so they never
 * overlap a scheduled run in another process — dev and prod sharing one database included.
 *
 * `withLock` is the same lease without a schedule: one holder across all processes (Zwift's).
 */
export class JobRunner {
  readonly owner: string;
  private readonly defs = new Map<string, JobDef>();
  private readonly active = new Set<Promise<void>>();
  private readonly localLocks = new Map<string, Promise<unknown>>();
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly concurrency: number;
  private readonly now: () => Date;
  private readonly jitter: (everyMs: number) => number;
  private readonly log: (line: string) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The loop is on (`start`). */
  private looping = false;
  /** Shutting down: claim nothing more. */
  private closing = false;

  constructor(
    private readonly c: Collections,
    opts: JobRunnerOptions = {},
  ) {
    this.owner = opts.owner ?? `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
    this.leaseMs = opts.leaseMs ?? 2 * 60_000;
    this.pollMs = opts.pollMs ?? 5_000;
    this.concurrency = opts.concurrency ?? 2;
    this.now = opts.now ?? (() => new Date());
    this.jitter = opts.jitter ?? ((every) => Math.floor(Math.random() * Math.min(every / 10, 60_000)));
    this.log = opts.log ?? ((line) => console.log(line));
  }

  register(kind: string, def: JobDef): this {
    this.defs.set(kind, def);
    return this;
  }

  // ── Schedule ────────────────────────────────────────────────────────────

  /** Make sure the job exists; a new one falls due shortly (with jitter), an existing one keeps its time. */
  schedule(kind: string, key: string): Promise<void> {
    const now = this.now();
    return ensureJob(this.c, kind, key, new Date(now.getTime() + this.jitter(this.def(kind).every)), now);
  }

  /** Due now. Picked up by the next loop pass in whichever process runs one. */
  kick(kind: string, key: string): Promise<void> {
    return kickJob(this.c, kind, key, this.now());
  }

  /** Due in `delayMs`, or sooner if it already was: a burst of these is one run (DECISIONS #64). */
  kickSoon(kind: string, key: string, delayMs: number): Promise<void> {
    const now = this.now();
    return kickJob(this.c, kind, key, now, new Date(now.getTime() + delayMs));
  }

  remove(kind: string, key: string): Promise<void> {
    return removeJob(this.c, kind, key);
  }

  /**
   * Due now, and started in this process if nobody holds it — so a manual "Full sync" runs even where
   * the loop is off (local dev). Returns whether it started here.
   */
  async trigger(kind: string, key: string): Promise<boolean> {
    await this.kick(kind, key);
    const job = await claimJob(this.c, kind, key, this.owner, this.now(), this.leaseMs);
    if (!job) return false;
    this.track(this.execute(job));
    return true;
  }

  // ── Manual runs and locks ───────────────────────────────────────────────

  /**
   * Run `fn` holding this job's lease — "Sync now". Waits for a run elsewhere to finish (up to
   * `waitMs`), then reschedules the job a full interval out.
   */
  async runNow<T>(kind: string, key: string, fn: () => Promise<T>, opts: { waitMs?: number } = {}): Promise<T> {
    const def = this.def(kind);
    const job = await this.claimWaiting(kind, key, opts.waitMs ?? 2 * 60_000);
    const stop = this.heartbeat(job._id);
    try {
      const result = await fn();
      await releaseJob(this.c, job._id, this.owner, this.now(), { next: this.later(def.every) });
      return result;
    } catch (err) {
      await releaseJob(this.c, job._id, this.owner, this.now(), { next: this.later(this.backoff(def, job)), error: (err as Error).message });
      throw err;
    } finally {
      stop();
    }
  }

  /** One holder at a time across every process; callers in this process queue up first. */
  withLock<T>(name: string, fn: () => Promise<T>, opts: { waitMs?: number } = {}): Promise<T> {
    const previous = this.localLocks.get(name) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const lock = await this.claimWaiting('lock', name, opts.waitMs ?? 10 * 60_000);
        const stop = this.heartbeat(lock._id);
        try {
          return await fn();
        } finally {
          stop();
          await releaseJob(this.c, lock._id, this.owner, this.now());
        }
      });
    this.localLocks.set(name, next);
    return next;
  }

  // ── Loop ────────────────────────────────────────────────────────────────

  start(): void {
    if (this.looping) return;
    this.looping = true;
    this.closing = false;
    this.log(`jobs: running ${[...this.defs.keys()].join(', ')} as ${this.owner}`);
    void this.tick();
  }

  /** Stop claiming, wait for running jobs (up to `waitMs`), and hand back every lease held here. */
  async stop(waitMs = 10_000): Promise<void> {
    this.looping = false;
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await Promise.race([Promise.allSettled([...this.active]), new Promise((r) => setTimeout(r, waitMs).unref?.())]);
    await releaseAllJobs(this.c, this.owner, this.now());
  }

  /** One pass: claim due jobs until the slots are full or nothing is due. Exposed for tests. */
  async tick(): Promise<void> {
    try {
      while (!this.closing && this.active.size < this.concurrency) {
        const job = await claimDueJob(this.c, [...this.defs.keys()], this.owner, this.now(), this.leaseMs);
        if (!job) break;
        this.track(this.execute(job));
      }
    } catch (err) {
      this.log(`jobs: claim failed — ${(err as Error).message}`);
    }
    if (this.looping) {
      this.timer = setTimeout(() => void this.tick(), this.pollMs);
      this.timer.unref?.();
    }
  }

  /** Resolves when every job running in this process has finished (tests). */
  async idle(): Promise<void> {
    while (this.active.size) await Promise.allSettled([...this.active]);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private def(kind: string): JobDef {
    const def = this.defs.get(kind);
    if (!def) throw new Error(`unknown job kind: ${kind}`);
    return def;
  }

  private async execute(job: JobDoc): Promise<void> {
    const def = this.defs.get(job.kind);
    if (!def) return releaseJob(this.c, job._id, this.owner, this.now());
    const stop = this.heartbeat(job._id);
    try {
      const next = await def.run(job.key);
      await releaseJob(this.c, job._id, this.owner, this.now(), { next: next === undefined ? this.later(def.every) : next });
    } catch (err) {
      const message = (err as Error).message;
      this.log(`jobs: ${job._id} failed — ${message}`);
      await releaseJob(this.c, job._id, this.owner, this.now(), { next: this.later(this.backoff(def, job)), error: message });
    } finally {
      stop();
    }
  }

  private track(p: Promise<void>) {
    const tracked = p.catch((err: Error) => this.log(`jobs: ${err.message}`)).finally(() => this.active.delete(tracked));
    this.active.add(tracked);
  }

  /** Renew the lease every third of its length while the work runs. */
  private heartbeat(id: string): () => void {
    const t = setInterval(() => {
      void extendLease(this.c, id, this.owner, this.now(), this.leaseMs).then((held) => {
        if (!held) this.log(`jobs: lost the lease on ${id}`);
      });
    }, Math.max(1, Math.floor(this.leaseMs / 3)));
    t.unref?.();
    return () => clearInterval(t);
  }

  private async claimWaiting(kind: string, key: string, waitMs: number): Promise<JobDoc> {
    const deadline = this.now().getTime() + waitMs;
    for (;;) {
      const job = await claimJob(this.c, kind, key, this.owner, this.now(), this.leaseMs);
      if (job) return job;
      if (this.now().getTime() >= deadline) throw new JobBusyError(`${jobId(kind, key)} is busy — try again shortly.`);
      await new Promise((r) => setTimeout(r, Math.min(this.pollMs, 1_000)));
    }
  }

  private later(ms: number): Date {
    return new Date(this.now().getTime() + ms);
  }

  /** 1 min, 2, 4 … capped at the job's own interval. */
  private backoff(def: JobDef, job: JobDoc): number {
    return Math.min(Math.max(def.every, MIN_BACKOFF_MS), MIN_BACKOFF_MS * 2 ** Math.min(job.attempts, 10));
  }
}
