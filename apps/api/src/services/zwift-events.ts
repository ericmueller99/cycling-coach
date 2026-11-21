import { deriveEvent, queryEvents, todayIn, addDays, withEstimates, type EventAthlete, type ZwiftRoute } from '@cycling-coach/core';
import {
  getProfile,
  getSyncState,
  getZwiftEvent,
  listZwiftEventMarks,
  listZwiftEvents,
  listZwiftRoutes,
  patchSyncState,
  removeMissingZwiftEvents,
  replaceZwiftEventMarks,
  saveZwiftEventMarks,
  saveZwiftRoutes,
  upsertZwiftEvents,
  zwiftCalendarLinks,
  zwiftEventsSummary,
  type Collections,
} from '@cycling-coach/db';
import type {
  EventQuery,
  EventQueryResult,
  EventsExtendResult as ExtendResult,
  EventsRefreshResult as RefreshResult,
  EventsSignupsResult as SignupsResult,
  EventsStatus,
  ExtendedRunStatus,
  ZwiftEvent,
} from '@cycling-coach/shared';
import { localLock, type IntegrationResolver, type Lock } from '../integrations';
import type { ZwiftClient, ZwiftPublic } from '../providers/zwift';
import { mapEvent, mapRoutes, mapUpcomingSignups, signedUpPens } from '../providers/zwift/events-map';
import { PUBLIC_PAGE_LIMIT } from '../providers/zwift/public';
import { walkEventFeed, walkPublicFeed } from './zwift-event-walk';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * The budgets that keep us polite to Zwift (DECISIONS #29). Every request also goes through the
 * shared 1-per-2-s gate, one at a time.
 */
export const EVENTS_LIMITS = {
  /** Public feed: ~28 h of events; measured at 3 pages of 200. */
  publicMaxPages: 5,
  /** "Refresh" is refused this soon after the last public sync. */
  publicRefreshMinMs: 15 * MIN,
  /** "Get more events" walks this far ahead… */
  extendedWindowMs: 7 * 24 * HOUR,
  /** …but never more than this many pages (a week measured ~65 of 50)… */
  extendedMaxPages: 120,
  /** …or for longer than this… */
  extendedMaxMs: 6 * MIN,
  /** …and can't be run again until this long after the last run, even across restarts. */
  extendedCooldownMs: 6 * HOUR,
  /** The daily walk skips a day when any walk ran this recently (DECISIONS #116). */
  dailySkipWithinMs: 20 * HOUR,
  /** "Refresh sign-ups" (one request) is refused this soon after the last one. */
  signupsCooldownMs: 5 * MIN,
  /** GameDictionary.xml is refreshed when older than this. */
  routesMaxAgeMs: 7 * 24 * HOUR,
} as const;

const latestStart = (events: ZwiftEvent[]) => events.reduce<string | undefined>((m, e) => (!m || e.start > m ? e.start : m), undefined);

/** An event leaves the database (TTL) this long after its last pen should have finished. */
const KEEP_AFTER_FINISH_MS = 2 * HOUR;
/** Events that started up to this long ago still show (late join). */
const SHOW_STARTED_MS = HOUR;

type Limits = { -readonly [K in keyof typeof EVENTS_LIMITS]: number };

/**
 * Zwift events in our own database. Pages only ever query Mongo; Zwift is called by the hourly
 * public sync, by "Refresh" (at most every 15 min), and by "Get more events" — when an athlete
 * with a Zwift login clicks it (at most every 6 h), and, unless the deployment turns it off, once a
 * day per athlete at a varying early-morning time (DECISIONS #116). Each is one paced cursor walk
 * with hard page and time budgets, using that athlete's own login (DECISIONS #52–53). Everything
 * shares one lock, so no two of these ever run side by side, whoever started them.
 */
export class ZwiftEventsService {
  private publicQueued = false;
  /** The running or last extended walk per athlete, in this process. */
  private readonly runs = new Map<string, ExtendedRunStatus>();
  private routes: Map<number, ZwiftRoute> | null = null;
  private cache: { events: ZwiftEvent[]; at: number } | null = null;
  private readonly limits: Limits;
  /** The daily walk is on (DECISIONS #116); only changes the status the page shows. */
  private readonly daily: boolean;

  constructor(
    private readonly c: Collections,
    private readonly pub: ZwiftPublic,
    private readonly integrations: Pick<IntegrationResolver, 'zwiftFor'>,
    private readonly now: () => Date,
    opts: Partial<Limits> & { daily?: boolean } = {},
    private readonly log: (line: string) => void = (line) => console.log(line),
    /** Every Zwift caller shares it: the server's spans processes, so only one ever talks to Zwift (#56). */
    private readonly zwiftLock: Lock = localLock(),
  ) {
    const { daily, ...limits } = opts;
    this.limits = { ...EVENTS_LIMITS, ...limits };
    this.daily = daily ?? false;
  }

  /** One job at a time: public sync, extended walk, route refresh and the metrics sync never overlap. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.zwiftLock(fn);
  }

  // ── Routes ──────────────────────────────────────────────────────────────

  private async routeTable(): Promise<Map<number, ZwiftRoute>> {
    this.routes ??= new Map((await listZwiftRoutes(this.c)).map((r) => [r.id, r]));
    return this.routes;
  }

  /** GameDictionary.xml → `zwift_routes`, when it's older than a week (or never fetched). */
  async refreshRoutes(): Promise<void> {
    return this.exclusive(async () => {
      const state = await getSyncState(this.c);
      const now = this.now();
      if (state?.lastRoutesAt && now.getTime() - state.lastRoutesAt.getTime() < this.limits.routesMaxAgeMs) return;
      const routes = mapRoutes(await this.pub.gameDictionary());
      if (!routes.length) throw new Error('GameDictionary.xml had no routes');
      await saveZwiftRoutes(this.c, routes, now);
      await patchSyncState(this.c, { lastRoutesAt: now }, [], now);
      this.routes = new Map(routes.map((r) => [r.id, r]));
      this.log(`zwift events: ${routes.length} routes`);
    });
  }

  // ── Public feed ─────────────────────────────────────────────────────────

  /**
   * The public upcoming list into `zwift_events`. The hourly timer and "Refresh" both land here;
   * neither runs within 15 min of the last sync, and a sync already queued or running absorbs
   * another request instead of adding calls.
   */
  async syncPublic(): Promise<RefreshResult> {
    // Persisted, so a restart (or a dev server reloading on every save) doesn't sync again either.
    const state = await getSyncState(this.c);
    const retryAt = state?.lastPublicSyncAt ? state.lastPublicSyncAt.getTime() + this.limits.publicRefreshMinMs : 0;
    if (retryAt > this.now().getTime()) return { kind: 'too_soon', retryAt: new Date(retryAt).toISOString() };
    if (this.publicQueued) return { kind: 'busy' };
    this.publicQueued = true;
    return this.exclusive(async () => {
      this.publicQueued = false;
      const started = this.now();
      try {
        const routes = await this.routeTable();
        const walk = await walkPublicFeed({
          fetchPage: (start) => this.pub.upcomingPage(start),
          storePage: async (raw) => {
            const events = this.derive(raw, routes, 'public');
            await upsertZwiftEvents(this.c, events.map((e) => ({ event: e, expiresAt: this.expiresAt(e) })), this.now(), { public: true });
            return { ids: events.map((e) => e.id), lastStart: latestStart(events) };
          },
          pageSize: PUBLIC_PAGE_LIMIT,
          maxPages: this.limits.publicMaxPages,
        });
        // Only a walk that reached the end of the list can say what's missing from it.
        const removed =
          walk.complete && walk.through
            ? await removeMissingZwiftEvents(this.c, { from: started.toISOString(), to: walk.through }, [...walk.ids], 'public')
            : 0;
        await patchSyncState(this.c, { lastPublicSyncAt: this.now() }, ['lastPublicError'], this.now());
        this.cache = null;
        this.log(`zwift events: public sync ${walk.pages} pages, ${walk.ids.size} events${removed ? `, ${removed} gone` : ''}${walk.stop ? ` — stopped: ${walk.stop}` : ''}`);
        return { kind: 'done' } as const;
      } catch (err) {
        const error = (err as Error).message;
        await patchSyncState(this.c, { lastPublicError: error }, [], this.now());
        this.log(`zwift events: public sync failed — ${error}`);
        return { kind: 'error', error } as const;
      }
    });
  }

  // ── Logged-in feed ("Get more events") ──────────────────────────────────

  /** Start the extended walk in the background. Never called by a timer or the coach. */
  async extend(userId: string): Promise<ExtendResult> {
    const zwift = await this.integrations.zwiftFor(userId);
    if (!zwift) return { kind: 'not_configured' };
    const current = this.runs.get(userId);
    if (current?.state === 'running') return { kind: 'running', status: current };
    const last = (await this.extendedState(userId))?.lastAt;
    const nextAllowed = last ? last.getTime() + this.limits.extendedCooldownMs : 0;
    if (nextAllowed > this.now().getTime()) return { kind: 'cooldown', nextAllowedAt: new Date(nextAllowed).toISOString() };

    const run: ExtendedRunStatus = { state: 'running', pages: 0, events: 0, startedAt: this.now().toISOString() };
    this.runs.set(userId, run);
    void this.exclusive(() => this.walk(userId, zwift, run)).catch((err: Error) => this.log(`zwift events: extended run crashed — ${err.message}`));
    return { kind: 'started', status: run };
  }

  /**
   * The daily walk (DECISIONS #116), from the `zwift.extended` job: the same walk as the button,
   * awaited. Skipped when any walk ran in the last 20 h, checked again under the lock so a click
   * that got there first wins. Never retried: a failed walk just waits for tomorrow.
   */
  async dailyWalk(userId: string): Promise<'ran' | 'failed' | 'skipped' | 'not_configured'> {
    const zwift = await this.integrations.zwiftFor(userId);
    if (!zwift) return 'not_configured';
    return this.exclusive(async () => {
      const last = (await this.extendedState(userId))?.lastAt;
      if (this.runs.get(userId)?.state === 'running') return 'skipped';
      if (last && this.now().getTime() - last.getTime() < this.limits.dailySkipWithinMs) return 'skipped';
      const run: ExtendedRunStatus = { state: 'running', pages: 0, events: 0, startedAt: this.now().toISOString() };
      this.runs.set(userId, run);
      await this.walk(userId, zwift, run);
      return run.state === 'error' ? 'failed' : 'ran';
    });
  }

  /**
   * "Refresh sign-ups" (DECISIONS #116): one logged-in request, `/api/events/upcoming`, that lists
   * every sign-up, so the athlete's marks become exactly that list. Only when clicked, at most every
   * 5 min, through the gate and the shared lock; never retried. A sign-up for an event we haven't
   * stored keeps its mark (it shows once a sync brings the event) and comes back in `elsewhere`.
   */
  async refreshSignups(userId: string): Promise<SignupsResult> {
    const zwift = await this.integrations.zwiftFor(userId);
    if (!zwift) return { kind: 'not_configured' };
    const last = (await this.c.integrations.findOne({ userId, provider: 'zwift' }, { projection: { signups: 1 } }))?.signups?.lastAt;
    const nextAllowed = last ? last.getTime() + this.limits.signupsCooldownMs : 0;
    if (nextAllowed > this.now().getTime()) return { kind: 'cooldown', nextAllowedAt: new Date(nextAllowed).toISOString() };

    return this.exclusive(async () => {
      let raw: unknown;
      try {
        raw = await zwift.upcomingSignups();
      } catch (err) {
        const error = (err as Error).message;
        await this.recordSignups(userId, { found: 0, error });
        this.log(`zwift events: sign-ups refresh failed — ${error}`);
        return { kind: 'error', error } as const;
      }
      const profile = await getProfile(this.c, userId);
      const me = profile?.zwiftId && /^\d+$/.test(profile.zwiftId) ? Number(profile.zwiftId) : undefined;
      const signups = mapUpcomingSignups(raw).filter((s) => me === undefined || s.profileId === undefined || s.profileId === me);
      const pens = new Map<number, number[]>();
      for (const s of signups) pens.set(s.eventId, [...(pens.get(s.eventId) ?? []), s.penId]);
      const elsewhere: Extract<SignupsResult, { kind: 'done' }>['elsewhere'] = [];
      const marks = await Promise.all(
        [...pens].map(async ([eventId, signedUpPenIds]) => {
          const event = await getZwiftEvent(this.c, eventId);
          const s = signups.find((x) => x.eventId === eventId)!;
          if (!event) elsewhere.push({ eventId, name: s.name, start: s.start });
          const fallback = new Date((s.start ? Date.parse(s.start) : this.now().getTime()) + 6 * HOUR);
          return { eventId, signedUpPenIds, expiresAt: event ? this.expiresAt(event) : fallback };
        }),
      );
      await replaceZwiftEventMarks(this.c, userId, marks);
      await this.recordSignups(userId, { found: pens.size });
      this.cache = null;
      this.log(`zwift events: sign-ups refreshed — ${pens.size} found${elsewhere.length ? `, ${elsewhere.length} not stored yet` : ''}`);
      return { kind: 'done', found: pens.size, elsewhere } as const;
    });
  }

  private async recordSignups(userId: string, s: { found: number; error?: string }) {
    const at = this.now();
    await this.c.integrations.updateOne(
      { userId, provider: 'zwift' },
      { $set: { signups: { lastAt: at, found: s.found, ...(s.error ? { error: s.error } : {}) }, updatedAt: at } },
      { upsert: true },
    );
  }

  /** The athlete's last extended walk, kept on their Zwift integration doc (the cooldown survives restarts). */
  private async extendedState(userId: string) {
    return (await this.c.integrations.findOne({ userId, provider: 'zwift' }, { projection: { extended: 1 } }))?.extended;
  }

  private async walk(userId: string, zwift: ZwiftClient, run: ExtendedRunStatus): Promise<void> {
    const t0 = this.now();
    const from = t0.getTime();
    const to = from + this.limits.extendedWindowMs;
    try {
      const routes = await this.routeTable();
      const walk = await walkEventFeed({
        fetchPage: (cursor) => zwift.eventFeedPage({ from, to, cursor }),
        storePage: async (raw, seen) => {
          const events = this.derive(raw, routes, 'extended');
          const fresh = events.filter((e) => !seen.has(e.id));
          const byId = new Map(fresh.map((e) => [e.id, e]));
          await upsertZwiftEvents(this.c, fresh.map((e) => ({ event: e, expiresAt: this.expiresAt(e) })), this.now());
          await saveZwiftEventMarks(
            this.c,
            userId,
            raw.flatMap((r) => {
              const e = byId.get((r as { id?: number }).id ?? -1);
              return e ? [{ eventId: e.id, signedUpPenIds: signedUpPens(r), expiresAt: this.expiresAt(e) }] : [];
            }),
          );
          const lastStart = latestStart(events);
          run.pages++;
          run.events = seen.size + fresh.length;
          if (lastStart && (!run.through || lastStart > run.through)) run.through = lastStart;
          this.cache = null;
          return { ids: events.map((e) => e.id), lastStart };
        },
        now: () => this.now().getTime(),
        to,
        maxPages: this.limits.extendedMaxPages,
        maxMs: this.limits.extendedMaxMs,
      });
      const end = walk.through && Date.parse(walk.through) < to ? walk.through : new Date(to).toISOString();
      const removed = walk.complete ? await removeMissingZwiftEvents(this.c, { from: t0.toISOString(), to: end }, [...walk.ids], 'extended') : 0;
      run.state = 'idle';
      run.finishedAt = this.now().toISOString();
      this.log(`zwift events: extended run ${walk.pages} pages, ${walk.ids.size} events${removed ? `, ${removed} gone` : ''}${walk.stop ? ` — stopped: ${walk.stop}` : ''}`);
    } catch (err) {
      run.state = 'error';
      run.error = (err as Error).message;
      run.finishedAt = this.now().toISOString();
      this.log(`zwift events: extended run failed after ${run.pages} pages — ${run.error}`);
    } finally {
      // The cooldown counts any run that reached Zwift, failed or not — a failing run must not be
      // retried in a loop.
      const finished = this.now();
      await this.c.integrations.updateOne(
        { userId, provider: 'zwift' },
        {
          $set: {
            extended: {
              lastAt: finished,
              pages: run.pages,
              events: run.events,
              ...(run.through ? { through: run.through } : {}),
              ...(run.error ? { error: run.error } : {}),
            },
            updatedAt: finished,
          },
        },
        { upsert: true },
      );
      run.nextAllowedAt = new Date(finished.getTime() + this.limits.extendedCooldownMs).toISOString();
      this.cache = null;
    }
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  async status(userId: string): Promise<EventsStatus> {
    const now = this.now();
    const [summary, state, zwift, doc] = await Promise.all([
      zwiftEventsSummary(this.c, new Date(now.getTime() - SHOW_STARTED_MS).toISOString()),
      getSyncState(this.c),
      this.integrations.zwiftFor(userId),
      this.c.integrations.findOne({ userId, provider: 'zwift' }, { projection: { extended: 1, signups: 1 } }),
    ]);
    const last = doc?.extended;
    const iso = (d: Date | undefined) => d?.toISOString();
    const future = (t: number) => (t > now.getTime() ? new Date(t).toISOString() : undefined);
    const running = this.runs.get(userId);
    const extended: ExtendedRunStatus | null = zwift
      ? running?.state === 'running'
        ? running
        : {
            state: last?.error ? 'error' : 'idle',
            pages: last?.pages ?? 0,
            events: last?.events ?? 0,
            through: summary.extendedThrough,
            finishedAt: iso(last?.lastAt),
            nextAllowedAt: last ? future(last.lastAt.getTime() + this.limits.extendedCooldownMs) : undefined,
            error: last?.error,
          }
      : null;
    if (extended) {
      if (this.daily) extended.daily = true;
      const signups = doc?.signups;
      if (signups) {
        extended.signupsAt = signups.lastAt.toISOString();
        extended.signupsAllowedAt = future(signups.lastAt.getTime() + this.limits.signupsCooldownMs);
      }
    }
    return {
      source: summary.count === 0 ? 'none' : summary.extendedThrough ? 'extended' : 'public',
      count: summary.count,
      through: summary.through,
      lastPublicSyncAt: iso(state?.lastPublicSyncAt),
      refreshAllowedAt: state?.lastPublicSyncAt ? future(state.lastPublicSyncAt.getTime() + this.limits.publicRefreshMinMs) : undefined,
      lastError: state?.lastPublicError,
      extended,
    };
  }

  /** Filter, count and page the stored events for this athlete. Never calls Zwift. */
  async query(userId: string, query: EventQuery): Promise<EventQueryResult> {
    const now = this.now();
    const profile = await getProfile(this.c, userId);
    const timeZone = profile?.timezone ?? 'UTC';
    const athlete: EventAthlete | null = profile
      ? {
          ftp: profile.ftpZwift,
          weightKg: profile.weightKg,
          zwiftWeightKg: profile.zwiftWeightKg,
          zftp: profile.zwift?.zftp,
          zmap: profile.zwift?.zmap,
          category: profile.zwift?.category,
          racingScore: profile.zwift?.racingScore,
          zwiftId: profile.zwiftId && /^\d+$/.test(profile.zwiftId) ? Number(profile.zwiftId) : undefined,
        }
      : null;
    const [events, signedUpPenIds, calendarEventIds] = await Promise.all([
      this.events(now),
      listZwiftEventMarks(this.c, userId),
      zwiftCalendarLinks(this.c, userId, addDays(todayIn(timeZone, now), -1)),
    ]);
    return queryEvents(events, query, athlete, { signedUpPenIds, calendarEventIds }, { now, timeZone });
  }

  /** Stored events, cached until the next write (a week is ~4,000; reading them takes ~100 ms). */
  private async events(now: Date): Promise<ZwiftEvent[]> {
    if (!this.cache || now.getTime() - this.cache.at > 5 * MIN) {
      this.cache = { events: await listZwiftEvents(this.c, new Date(now.getTime() - SHOW_STARTED_MS).toISOString()), at: now.getTime() };
    }
    return this.cache.events;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private derive(raw: unknown[], routes: Map<number, ZwiftRoute>, seenVia: ZwiftEvent['seenVia']): ZwiftEvent[] {
    return raw.flatMap((r) => {
      const src = mapEvent(r);
      const event = src && deriveEvent(src, (id) => (id === undefined ? undefined : routes.get(id)), seenVia);
      return event ? [event] : [];
    });
  }

  /** The last pen's start + its ride time (90 min when unknown) + 2 h. */
  private expiresAt(event: ZwiftEvent): Date {
    const end = Math.max(...withEstimates(event, null).map((p) => Date.parse(p.start) + (p.estMin ?? 90) * MIN));
    return new Date(end + KEEP_AFTER_FINISH_MS);
  }
}
