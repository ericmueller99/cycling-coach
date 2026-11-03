import type { Collections } from '@cycling-coach/db';
import type { IntervalsSync } from '../services/intervals-sync';
import type { ZwiftEventsService } from '../services/zwift-events';
import type { ZwiftSync } from '../services/zwift-sync';
import type { JobRunner } from './runner';

export { JobBusyError, JobRunner, type JobDef, type JobRunnerOptions } from './runner';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Job kinds (DECISIONS #56). Per-athlete jobs are keyed by userId; the rest by `GLOBAL`. */
export const JOB = {
  /** The intervals.icu delta sync (DECISIONS #49), every 15 min per connected athlete. */
  delta: 'intervals.delta',
  /** A full history import, in slices, until it's done; then the job is deleted. */
  full: 'intervals.full',
  /** zFTP/zMAP/weight from Zwift (DECISIONS #23), every 6 h per athlete with a Zwift login. */
  zwiftMetrics: 'zwift.metrics',
  /** The public Zwift events feed (DECISIONS #29), hourly; the route table first when it's a week old. */
  zwiftPublic: 'zwift.public',
  /** Re-checks which jobs should exist (new athletes, connections made or dropped), hourly. */
  ensure: 'jobs.ensure',
} as const;
export const GLOBAL = 'global';

export interface JobDeps {
  c: Collections;
  sync: IntervalsSync;
  zwiftSync: ZwiftSync;
  zwiftEvents: ZwiftEventsService;
  now: () => Date;
  log?: (line: string) => void;
}

/** What each job does. The same registrations serve the API process and a standalone worker. */
export function registerJobs(jobs: JobRunner, d: JobDeps): JobRunner {
  const log = d.log ?? ((line: string) => console.warn(line));
  return jobs
    .register(JOB.delta, {
      every: 15 * MIN,
      run: async (userId) => {
        await d.sync.run(userId);
      },
    })
    .register(JOB.full, { every: MIN, run: (userId) => d.sync.fullRun(userId) })
    .register(JOB.zwiftMetrics, {
      every: 6 * HOUR,
      run: async (userId) => {
        await d.zwiftSync.run(userId, d.now());
      },
    })
    .register(JOB.zwiftPublic, {
      every: HOUR,
      run: async () => {
        await d.zwiftEvents.refreshRoutes().catch((err: Error) => log(`Zwift routes refresh failed — ${err.message}`));
        const result = await d.zwiftEvents.syncPublic();
        if (result.kind === 'error') throw new Error(result.error);
      },
    })
    .register(JOB.ensure, {
      every: HOUR,
      run: async () => {
        await ensureJobs(jobs, d);
      },
    });
}

/**
 * Make the job set match reality: a delta job for every athlete with intervals.icu connected, a
 * metrics job for every athlete with a Zwift login, a running full import resumed, the global jobs
 * present. Existing jobs keep their schedule, so a deploy doesn't re-run everything at once.
 */
export async function ensureJobs(jobs: JobRunner, d: JobDeps): Promise<void> {
  const profiles = await d.c.profiles.find({}, { projection: { userId: 1 } }).toArray();
  for (const { userId } of profiles) await ensureUserJobs(jobs, d, userId);
  const importing = await d.c.integrations
    .find({ provider: 'intervals_icu', 'fullSync.status': 'running' }, { projection: { userId: 1, fullSync: 1 } })
    .toArray();
  for (const doc of importing) if (doc.fullSync?.phase !== 'match') await jobs.schedule(JOB.full, doc.userId);
  await jobs.schedule(JOB.zwiftPublic, GLOBAL);
  await jobs.schedule(JOB.ensure, GLOBAL);
}

/**
 * One athlete's per-user jobs, from their current connections: a delta job while intervals.icu is
 * connected, a metrics job while they have a Zwift login. Returns what's connected.
 */
export async function ensureUserJobs(jobs: JobRunner, d: Pick<JobDeps, 'sync' | 'zwiftSync'>, userId: string): Promise<{ intervals: boolean; zwift: boolean }> {
  const intervals = await d.sync.connected(userId);
  if (intervals) await jobs.schedule(JOB.delta, userId);
  else await jobs.remove(JOB.delta, userId);
  const zwift = await d.zwiftSync.connected(userId);
  if (zwift) await jobs.schedule(JOB.zwiftMetrics, userId);
  else await jobs.remove(JOB.zwiftMetrics, userId);
  return { intervals, zwift };
}
