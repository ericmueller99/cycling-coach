import {
  addDays,
  classifyWorkout,
  diffActivities,
  EMPTY_QUARTERS_TO_STOP,
  deltaWindow,
  flatten,
  inferSessionType,
  parseZwo,
  previousQuarter,
  quarterOf,
  SYNC_OVERLAP_DAYS,
  todayIn,
  trendWeight,
  weighInsFrom,
} from '@cycling-coach/core';
import {
  countActivities,
  createEvent,
  createWorkout,
  deleteActivities,
  deleteCourse,
  redateGoalForEvent,
  unlinkGoalFromEvent,
  deleteEvent,
  getEvent,
  getProfile,
  getWorkout,
  listPendingSync,
  listSyncedEvents,
  listWellness,
  listWorkouts,
  markDetailUnavailable,
  patchEvent,
  ridesNeedingDetail,
  saveActivities,
  saveActivityDetail,
  savePowerBest,
  saveWellness,
  setEventSync,
  setSyncedWeight,
  storedRideRefs,
  type Collections,
  type FullSyncState,
  type IntegrationDoc,
} from '@cycling-coach/db';
import {
  powerBestDurations,
  type CalendarEvent,
  type FullSyncProgress,
  type IntegrationStatus,
  type IsoDate,
  type PowerBest,
  type PowerCurvePeriod,
  type WorkoutSegment,
} from '@cycling-coach/shared';
import type { IntegrationResolver } from '../integrations';
import { IntervalsError, isTransient, UNSHARED_STATUS, type IntervalsIcu, type RemoteEvent } from '../providers/intervals-icu';
import type { CalendarService } from './calendar';
import { reconcile } from './calendar-reconcile';
import { MATCH_DAYS, settleRides } from './rides';

/**
 * intervals.icu is the hub Garmin, Zwift and Strava feed; we sync from it into our own collections
 * and every screen reads those (DECISIONS #49). Two jobs share one paced gate (1 request/s):
 *
 * - **Delta** (`run`, every 15 min, "Sync now"): push owed calendar changes, reconcile the calendar
 *   window, then re-read rides and wellness from the last successful sync (less a week) to today,
 *   match done/missed, refresh weight, power curves when something changed, and a few rides'
 *   detected intervals. ~3 requests when nothing happened.
 * - **Full import** (first run, or "Full sync"): all rides quarter by quarter back to the first,
 *   wellness year by year, every ride's intervals, then done/missed across everything. It persists
 *   its cursor after each request, so a restart or a rate limit only pauses it.
 */

/** Calendar events: recent past (for done/missed) and the planning horizon. */
const EVENT_WINDOW = { back: 21, ahead: 120 };
/** The full import's last step also reconciles a long calendar span. */
const EVENT_BACKFILL = { back: 400, ahead: 400 };
const WEIGHT_DAYS = 14;
const CURVE_PERIODS: PowerCurvePeriod[] = ['90d', 'season', '1y', 'allTime'];
const BEST_PERIODS = new Set<PowerCurvePeriod>(['90d', 'season', 'allTime']);
/** Detected intervals fetched per delta run, for rides that arrived since the last one. */
const DETAILS_PER_RUN = 10;
const ATHLETE_EVERY_MS = 60 * 60 * 1000;
/** No athlete has rides from before this; a full import never walks further back. */
const HISTORY_FLOOR = '2000-01-01';

/** intervals.icu refused the key or token, as opposed to failing. */
const REJECTED = [401, 403];
const isRejected = (status: number | undefined) => status !== undefined && REJECTED.includes(status);

export interface SyncReport {
  pushed: number;
  imported: number;
  updated: number;
  removed: number;
  rides: number;
  ridesRemoved: number;
  details: number;
  matched: number;
  missed: number;
  bests: number;
  weightKg?: number | undefined;
}

const progressOf = (s: FullSyncState): FullSyncProgress => {
  const { cursor: _c, emptyRun: _e, oldest: _o, ...progress } = s;
  return progress;
};

const sameSegments = (a: readonly WorkoutSegment[], b: readonly WorkoutSegment[]) =>
  JSON.stringify(flatten(a).map(({ durSec, pct, pctEnd }) => [durSec, pct, pctEnd ?? null])) ===
  JSON.stringify(flatten(b).map(({ durSec, pct, pctEnd }) => [durSec, pct, pctEnd ?? null]));


export interface SyncJobs {
  /** Run (or continue) this athlete's full import as the `intervals.full` job. */
  full(userId: string): Promise<unknown>;
  /** A delta soon — the full import's final pass. */
  delta(userId: string): Promise<unknown>;
}

/** How long one `intervals.full` job run keeps stepping before it yields (and is picked up again at once). */
export const FULL_SLICE_MS = 4 * 60_000;

/**
 * When a manual sync may run again: null if it may now, or if there's no limit (DECISIONS #75).
 * `last` is the last finished run, so a failed one never blocks a retry.
 */
export function manualRetryAt(last: string | undefined, everyMs: number | undefined, now: Date): Date | null {
  if (!last || !everyMs) return null;
  const next = new Date(last).getTime() + everyMs;
  return next > now.getTime() ? new Date(next) : null;
}

export class IntervalsSync {
  /**
   * Delta runs, one at a time per athlete in this process. Across processes the `intervals.delta` job
   * lease does the same (DECISIONS #56): two overlapping runs would import a new event twice.
   */
  private readonly queue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly c: Collections,
    private readonly integrations: Pick<IntegrationResolver, 'intervalsFor'>,
    private readonly calendar: CalendarService,
    /** The job runner's side of things: start/continue the full import, and run a delta soon. */
    private readonly jobs: SyncJobs,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** This athlete's client. Callers check `connected` first; losing it mid-run is an error. */
  private async client(userId: string): Promise<IntervalsIcu> {
    const icu = await this.integrations.intervalsFor(userId);
    if (!icu) throw new IntervalsError('intervals.icu is not connected');
    return icu;
  }

  async connected(userId: string): Promise<boolean> {
    return !!(await this.integrations.intervalsFor(userId));
  }

  private integration(userId: string): Promise<IntegrationDoc | null> {
    return this.c.integrations.findOne({ userId, provider: 'intervals_icu' });
  }

  private async update(userId: string, set: Partial<IntegrationDoc>, unset: (keyof IntegrationDoc | `fullSync.${string}`)[] = []) {
    await this.c.integrations.updateOne(
      { userId, provider: 'intervals_icu' },
      {
        $set: { ...set, updatedAt: this.now() },
        ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ''])) } : {}),
      },
      { upsert: true },
    );
  }

  /** What the Connections card and the dashboard show: all from our own bookkeeping. */
  async status(userId: string): Promise<IntegrationStatus> {
    if (!(await this.connected(userId))) return { status: 'not_configured' };
    const doc = await this.integration(userId);
    // A rejected key or token stays broken however well it once worked (DECISIONS #64).
    const broken = !!doc?.lastError && (!doc.lastSyncAt || isRejected(doc.lastErrorStatus));
    return {
      status: broken ? 'error' : 'connected',
      ...(doc?.athlete?.athleteId ? { athleteId: doc.athlete.athleteId } : {}),
      ...(doc?.athlete ? { zwiftConnected: !!doc.athlete.zwiftConnected } : {}),
      ...(doc?.athlete?.ftp ? { ftp: doc.athlete.ftp } : {}),
      ...(doc?.lastSyncAt ? { lastSyncAt: doc.lastSyncAt.toISOString() } : {}),
      ...(doc?.lastError ? { lastError: doc.lastError } : {}),
      ...(doc?.lastFullSyncAt ? { lastFullSyncAt: doc.lastFullSyncAt.toISOString() } : {}),
      ...(doc?.fullSync ? { fullSync: progressOf(doc.fullSync) } : {}),
    };
  }

  /** intervals.icu says the athlete's settings changed: the next delta re-reads the athlete record. */
  async markAthleteStale(userId: string): Promise<void> {
    await this.update(userId, { athleteStale: true });
  }

  /** New credentials: a past rejection no longer applies, so don't show it while the first sync runs. */
  async clearRejection(userId: string): Promise<void> {
    await this.c.integrations.updateOne(
      { userId, provider: 'intervals_icu', lastErrorStatus: { $in: REJECTED } },
      { $unset: { lastError: '', lastErrorStatus: '' }, $set: { updatedAt: this.now() } },
    );
  }

  /**
   * A workout from intervals.icu as a library workout: its .zwo, parsed by our own parser, reusing
   * an identical library workout when there is one.
   */
  private async workoutFor(userId: string, remote: RemoteEvent, basedOnId: string | undefined, now: Date) {
    let parsed: ReturnType<typeof parseZwo>;
    try {
      const icu = await this.client(userId);
      parsed = parseZwo(await icu.downloadEventZwo(remote.id));
    } catch {
      return null;
    }
    if (parsed.segments.length === 0) return null;
    const existing = (await listWorkouts(this.c, userId)).find((w) => w.name === remote.name && sameSegments(w.segments, parsed.segments));
    if (existing) return existing;
    return createWorkout(
      this.c,
      userId,
      {
        name: remote.name.slice(0, 80),
        category: classifyWorkout(parsed.segments),
        ...(parsed.description || remote.description ? { description: (parsed.description || remote.description)!.slice(0, 2000) } : {}),
        segments: parsed.segments,
        inZwift: remote.platform === 'zwift',
        ...(basedOnId ? { basedOnId } : {}),
      },
      'import',
      now,
    );
  }

  private async importRemote(userId: string, r: RemoteEvent, now: Date) {
    const link = { eventId: r.id, uid: r.uid, remoteUpdated: r.updated, syncedAt: now.toISOString() };
    const base = {
      date: r.date,
      title: r.name.slice(0, 120),
      platform: r.platform,
      tentative: false,
      ...(r.startTime ? { startTime: r.startTime } : {}),
      ...(r.movingSec ? { durationMin: Math.round(r.movingSec / 60) } : {}),
      ...(r.description ? { coachNote: r.description.slice(0, 1000) } : {}),
    };
    if (r.kind === 'race') {
      return createEvent(this.c, userId, { ...base, kind: 'race', type: 'race', priority: r.priority ?? 'B' }, { source: 'intervals', intervals: link }, now);
    }
    const workout = await this.workoutFor(userId, r, undefined, now);
    // A planned workout with no structure we can read becomes a plain ride, still linked.
    return createEvent(
      this.c,
      userId,
      workout
        ? { ...base, kind: 'workout', type: inferSessionType(workout.segments), workoutId: workout.id }
        : { ...base, kind: 'ride', type: 'endurance' },
      { source: 'intervals', intervals: link },
      now,
    );
  }

  /** An edit made in intervals.icu: take its date, time, name and length — and new structure. */
  private async applyRemote(userId: string, local: CalendarEvent, r: RemoteEvent, now: Date) {
    let workoutId = local.workoutId;
    if (local.kind === 'workout' && workoutId) {
      const current = await getWorkout(this.c, userId, workoutId);
      const latest = await this.workoutFor(userId, r, workoutId, now);
      if (latest && current && !sameSegments(current.segments, latest.segments)) workoutId = latest.id;
    }
    await patchEvent(
      this.c,
      userId,
      local.id,
      {
        date: r.date,
        title: r.name.slice(0, 120),
        ...(r.startTime ? { startTime: r.startTime } : {}),
        ...(r.movingSec ? { durationMin: Math.round(r.movingSec / 60) } : {}),
        ...(r.priority ? { priority: r.priority } : {}),
        ...(workoutId ? { workoutId } : {}),
      },
      now,
    );
    await setEventSync(this.c, userId, local.id, { intervals: { ...local.intervals!, remoteUpdated: r.updated, syncedAt: now.toISOString() } }, now);
    // Moved in intervals.icu: its goal's date follows (DECISIONS #100).
    if (r.date !== local.date) await redateGoalForEvent(this.c, userId, local.id, r.date);
  }


  // ── Delta ─────────────────────────────────────────────────────────────────

  /** The regular sync, queued behind any run already going for this athlete. */
  run(userId: string): Promise<SyncReport> {
    const previous = this.queue.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.delta(userId));
    this.queue.set(userId, next);
    return next;
  }

  private async delta(userId: string): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, imported: 0, updated: 0, removed: 0, rides: 0, ridesRemoved: 0, details: 0, matched: 0, missed: 0, bests: 0 };
    const profile = await getProfile(this.c, userId);
    // An athlete without intervals.icu has nothing to sync (DECISIONS #53).
    if (!profile || !(await this.connected(userId))) return report;
    const now = this.now();
    const today = todayIn(profile.timezone, now);
    const doc = await this.integration(userId);

    // First run ever (or history never imported): start the full import beside this run. A full
    // import that's stopped — a restart, a rate limit — picks up again here.
    const full = doc?.fullSync;
    if (!doc?.lastFullSyncAt && !full) await this.startFullSync(userId);
    else if (full?.status === 'running' && full.phase !== 'match') await this.jobs.full(userId);
    const finishing = full?.status === 'running' && full.phase === 'match';

    const window = deltaWindow(doc?.lastSyncAt ? todayIn(profile.timezone, doc.lastSyncAt) : undefined, today) ?? {
      from: addDays(today, -SYNC_OVERLAP_DAYS),
      to: today,
    };

    try {
      // 1. Re-push failed updates first, so reconciling sees our latest version. Sessions never
      //    pushed wait until after reconciling: their create may have reached intervals.icu with
      //    the response lost, and adopting beats creating a duplicate.
      const pending = await listPendingSync(this.c, userId);
      for (const e of pending.filter((p) => p.intervals)) {
        const pushed = await this.calendar.push(userId, e);
        if (!pushed.intervals?.error) report.pushed++;
      }

      // 2. Pull intervals.icu's calendar and reconcile. A date window, always: an event deleted
      //    there only shows as missing from the list.
      const span = finishing ? EVENT_BACKFILL : EVENT_WINDOW;
      const from = addDays(today, -span.back);
      const to = addDays(today, span.ahead);
      const icu = await this.client(userId);
      const [remote, local] = await Promise.all([icu.listEvents(from, to), listSyncedEvents(this.c, userId, from, to)]);
      for (const action of reconcile(local, remote)) {
        switch (action.type) {
          case 'import':
            await this.importRemote(userId, action.remote, now);
            report.imported++;
            break;
          case 'adopt': {
            const linked = await setEventSync(
              this.c,
              userId,
              action.local.id,
              { intervals: { eventId: action.remote.id, uid: action.remote.uid, remoteUpdated: action.remote.updated }, syncError: null },
              now,
            );
            if (linked) await this.calendar.push(userId, linked); // ours is the version that counts
            report.pushed++;
            break;
          }
          case 'update':
            await this.applyRemote(userId, action.local, action.remote, now);
            report.updated++;
            break;
          case 'remove-local':
            await deleteEvent(this.c, userId, action.local.id);
            // Its course goes with it (DECISIONS #99); its goal stays, unlinked (#100).
            await deleteCourse(this.c, userId, action.local.id);
            await unlinkGoalFromEvent(this.c, userId, action.local.id);
            report.removed++;
            break;
        }
      }

      // Now create what's never been pushed (anything adopted above is linked and skipped).
      for (const e of pending.filter((p) => !p.intervals)) {
        const fresh = await getEvent(this.c, userId, e.id);
        if (!fresh || fresh.intervals) continue;
        const pushed = await this.calendar.push(userId, fresh);
        if (!pushed.syncError) report.pushed++;
      }

      // 3. Rides and wellness since the last successful sync.
      const rides = await this.syncRides(userId, window.from, window.to, now);
      report.rides = rides.changed;
      report.ridesRemoved = rides.removed;
      await saveWellness(this.c, userId, await icu.wellness(window.from, window.to), now);

      // 4. Done / missed, from the stored rides — across all history when a full import finishes.
      const matchFrom = finishing ? (full.oldest ?? addDays(today, -400)) : [window.from, addDays(today, -MATCH_DAYS)].sort()[0]!;
      const settled = await settleRides(this.c, userId, matchFrom, today, now);
      report.matched = settled.matched;
      report.missed += settled.missed;

      // 5. Weight: the trend, not the last reading.
      const weight = trendWeight(weighInsFrom(await listWellness(this.c, userId, addDays(today, -WEIGHT_DAYS), today)));
      if (weight) {
        await setSyncedWeight(this.c, userId, weight, now);
        report.weightKg = weight.trendKg;
      }

      // 6. Power curves when there's something new, and once a day (the windows roll).
      const curvesStale = !doc?.curvesAt || todayIn(profile.timezone, doc.curvesAt) !== today;
      if (rides.changed || rides.removed || curvesStale || finishing) report.bests = await this.syncCurves(userId, now);

      // 7. The athlete record (Zwift connected, FTP), hourly.
      if (!doc?.athlete || doc.athleteStale || now.getTime() - doc.athlete.at.getTime() > ATHLETE_EVERY_MS) {
        await this.update(userId, { athlete: { ...(await icu.athlete()), at: now } }, ['athleteStale']);
      }

      // 8. A few new rides' detected intervals (the full import does them all when it runs).
      if (full?.status !== 'running') report.details = await this.fetchDetails(userId, DETAILS_PER_RUN);

      const done = finishing ? (({ label: _l, waitingUntil: _w, error: _e, ...rest }) => ({ ...rest, status: 'done' as const, finishedAt: now.toISOString() }))(full) : null;
      await this.update(userId, { lastSyncAt: now, ...(done ? { lastFullSyncAt: now, fullSync: done } : {}) }, ['lastError', 'lastErrorStatus']);
      return report;
    } catch (err) {
      const status = err instanceof IntervalsError ? err.status : undefined;
      await this.update(userId, { lastError: (err as Error).message, ...(status ? { lastErrorStatus: status } : {}) }, status ? [] : ['lastErrorStatus']);
      throw err;
    }
  }

  /** List a window's rides, write what's new or changed, drop what intervals.icu no longer has. */
  private async syncRides(userId: string, from: IsoDate, to: IsoDate, now: Date): Promise<{ listed: number; changed: number; removed: number }> {
    const icu = await this.client(userId);
    const [{ rides, hidden }, stored] = await Promise.all([icu.listRides(from, to), storedRideRefs(this.c, userId, from, to)]);
    const { changed, removed } = diffActivities(stored, rides, hidden);
    await saveActivities(this.c, userId, changed, now);
    await deleteActivities(this.c, userId, removed);
    return { listed: rides.length, changed: changed.length, removed: removed.length };
  }

  /** Athlete curves; power bests from them, keeping a higher manual entry (an outdoor ride intervals.icu never saw). */
  private async syncCurves(userId: string, now: Date): Promise<number> {
    const icu = await this.client(userId);
    const [curves, existing] = await Promise.all([icu.powerCurves(CURVE_PERIODS), this.c.powerBests.find({ userId }).toArray()]);
    await this.update(userId, { curves, curvesAt: now });
    let saved = 0;
    for (const curve of curves.filter((c) => BEST_PERIODS.has(c.period))) {
      for (const durationSec of powerBestDurations) {
        const point = curve.points.find((p) => p.durationSec === durationSec);
        if (!point) continue;
        const current = existing.find((b) => b.period === curve.period && b.durationSec === durationSec);
        if (current?.watts && current.source !== 'intervals.icu' && current.watts > point.watts) continue;
        if (current?.watts === point.watts && current.source === 'intervals.icu') continue;
        const best: PowerBest = {
          period: curve.period as PowerBest['period'],
          durationSec,
          watts: point.watts,
          source: 'intervals.icu',
          ...(point.activityId ? { activityId: point.activityId } : {}),
        };
        await savePowerBest(this.c, userId, best, now);
        saved++;
      }
    }
    return saved;
  }

  /** Fetch up to `limit` rides' detected intervals, one request at a time. */
  private async fetchDetails(userId: string, limit: number): Promise<number> {
    let done = 0;
    for (const id of await ridesNeedingDetail(this.c, userId, limit)) {
      await this.fetchDetail(userId, id);
      done++;
    }
    return done;
  }

  private async fetchDetail(userId: string, id: string): Promise<void> {
    try {
      const icu = await this.client(userId);
      const d = await icu.activityDetail(id);
      await saveActivityDetail(this.c, userId, d.activity, d.intervals, this.now());
    } catch (err) {
      // Deleted in intervals.icu since it was listed: drop our copy. A hidden ride still exists: keep it.
      if (err instanceof IntervalsError && err.status === 404) await deleteActivities(this.c, userId, [id]);
      else if (err instanceof IntervalsError && err.status === UNSHARED_STATUS) await markDetailUnavailable(this.c, userId, id, this.now());
      else throw err;
    }
  }

  // ── Full import ───────────────────────────────────────────────────────────

  /**
   * Start a full import of all history ("Full sync", or the first run). Returns at once; the work
   * runs in the background. Starting while one runs just reports it.
   */
  async startFullSync(userId: string): Promise<FullSyncProgress> {
    await this.client(userId);
    const doc = await this.integration(userId);
    if (doc?.fullSync?.status === 'running') {
      if (doc.fullSync.phase !== 'match') await this.jobs.full(userId);
      return progressOf(doc.fullSync);
    }
    const profile = await getProfile(this.c, userId);
    const today = todayIn(profile?.timezone ?? 'UTC', this.now());
    const first = quarterOf(today);
    const state: FullSyncState = {
      status: 'running',
      phase: 'activities',
      label: first.label,
      done: 0,
      total: 0,
      rides: 0,
      startedAt: this.now().toISOString(),
      cursor: first.from,
      emptyRun: 0,
    };
    await this.update(userId, { fullSync: state });
    await this.jobs.full(userId);
    return progressOf(state);
  }

  /**
   * The `intervals.full` job: one request per step, the state saved after each, for up to `sliceMs`.
   * Returns when to run again — now (more to do), after a rate limit or outage (`waitingUntil`), or
   * `null` when the import is over (done, failed, or handed to the delta's final pass). A crash just
   * resumes from the saved step once the job's lease runs out.
   */
  async fullRun(userId: string, sliceMs = FULL_SLICE_MS): Promise<Date | null> {
    // Disconnected: not a failure to retry. The state stays, so a reconnect's delta resumes it.
    if (!(await this.connected(userId))) return null;
    const profile = await getProfile(this.c, userId);
    const timezone = profile?.timezone ?? 'UTC';
    const until = this.now().getTime() + sliceMs;
    for (;;) {
      const s = (await this.integration(userId))?.fullSync;
      if (!s || s.status !== 'running') return null;
      const now = this.now();
      if (now.getTime() >= until) return now;
      let next: FullSyncState | 'finish';
      try {
        next = await this.fullStep(userId, s, todayIn(timezone, now), now);
      } catch (err) {
        if (isTransient(err)) {
          const wait = err instanceof IntervalsError && err.retryAt ? err.retryAt : new Date(now.getTime() + 60_000);
          await this.update(userId, { fullSync: { ...s, waitingUntil: wait.toISOString(), error: (err as Error).message } });
          return wait;
        }
        await this.update(userId, { fullSync: { ...s, status: 'failed', finishedAt: now.toISOString(), error: (err as Error).message } });
        return null;
      }
      if (next === 'finish') {
        // The delta's last pass matches done/missed over everything and marks the import done. If
        // it fails, the state stays at `match` and the next scheduled delta finishes it.
        await this.jobs.delta(userId);
        return null;
      }
      const { waitingUntil: _w, error: _e, ...clean } = next;
      await this.update(userId, { fullSync: clean });
    }
  }

  private async fullStep(userId: string, s: FullSyncState, today: IsoDate, now: Date): Promise<FullSyncState | 'finish'> {
    const thisYear = Number(today.slice(0, 4));
    switch (s.phase) {
      case 'activities': {
        const q = quarterOf(s.cursor ?? today);
        const rides = await this.syncRides(userId, q.from, q.to, now);
        const emptyRun = rides.listed ? 0 : (s.emptyRun ?? 0) + 1;
        const oldest = rides.listed ? q.from : s.oldest;
        const found = s.rides + rides.listed;
        if (emptyRun < EMPTY_QUARTERS_TO_STOP && q.from > HISTORY_FLOOR) {
          return { ...s, cursor: previousQuarter(q).from, emptyRun, ...(oldest ? { oldest } : {}), rides: found, done: s.done + 1, label: q.label };
        }
        const firstYear = Number((oldest ?? today).slice(0, 4));
        return {
          ...s,
          phase: 'wellness',
          cursor: String(firstYear),
          emptyRun,
          ...(oldest ? { oldest } : {}),
          rides: found,
          done: 0,
          total: thisYear - firstYear + 1,
          label: String(firstYear),
        };
      }
      case 'wellness': {
        const year = Number(s.cursor ?? thisYear);
        const end = `${year}-12-31` < today ? `${year}-12-31` : today;
        const icu = await this.client(userId);
        await saveWellness(this.c, userId, await icu.wellness(`${year}-01-01`, end), now);
        if (year < thisYear) return { ...s, cursor: String(year + 1), done: s.done + 1, label: String(year + 1) };
        const { cursor: _c, label: _l, ...rest } = s;
        return { ...rest, phase: 'details', done: 0, total: await countActivities(this.c, userId, { needingDetail: true }) };
      }
      case 'details': {
        const [id] = await ridesNeedingDetail(this.c, userId, 1);
        if (!id) return this.toMatch(userId, s);
        await this.fetchDetail(userId, id);
        const remaining = await countActivities(this.c, userId, { needingDetail: true });
        const done = s.done + 1;
        return { ...s, done, total: done + remaining };
      }
      case 'match':
        return 'finish';
    }
  }

  private async toMatch(userId: string, s: FullSyncState): Promise<'finish'> {
    const { label: _l, waitingUntil: _w, error: _e, ...rest } = s;
    await this.update(userId, { fullSync: { ...rest, phase: 'match' } });
    return 'finish';
  }
}
