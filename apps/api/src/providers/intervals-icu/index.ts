import type { Activity, ActivityDetail, IntegrationStatus, IsoDate, PowerCurve, PowerCurvePeriod, PowerPoint, WellnessDay } from '@cycling-coach/shared';
import { RequestGate } from '../gate';
export type { RemoteEvent } from './map';
import {
  CURVE_IDS,
  mapActivities,
  mapActivity,
  mapCurvePoints,
  mapInterval,
  mapPowerCurves,
  mapRemoteEvents,
  mapWellnessDays,
  SYNCED_CATEGORIES,
  type RemoteEvent,
} from './map';

/**
 * How a request proves who it's for: an athlete's personal API key (self-host) or an OAuth access
 * token issued to the hosted app. intervals.icu tokens have no refresh token (DECISIONS #53).
 */
export type IntervalsAuth = { kind: 'apiKey'; key: string } | { kind: 'bearer'; token: string };

export interface IntervalsIcuOptions {
  auth: IntervalsAuth;
  /** "0" means the athlete who owns the key or token — valid for both kinds. */
  athleteId?: string | undefined;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /**
   * Paces every request (DECISIONS #49). Defaults to one request a second for this client; the
   * integration resolver shares one gate across all athletes, because intervals.icu rate-limits a
   * whole OAuth app and each IP, not each token.
   */
  gate?: RequestGate;
}

export class IntervalsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** On a 429: when intervals.icu said to come back. */
    readonly retryAt?: Date,
  ) {
    super(message);
  }
}

/** A rate limit or an outage: worth waiting out and trying again later, unlike a bad key. */
export const isTransient = (err: unknown) => err instanceof IntervalsError && (err.status === 429 || err.status === undefined || err.status >= 500);

/** All intervals.icu traffic: one request a second, one in flight. */
export const INTERVALS_MIN_INTERVAL_MS = 1_000;
/** A 429 without a usable Retry-After waits this long; a longer one is capped here. */
const DEFAULT_RETRY_MS = 60_000;
const MAX_RETRY_MS = 15 * 60_000;

const CURVE_DURATIONS = [5, 15, 30, 60, 120, 180, 300, 480, 720, 1200, 3600];
const TIMEOUT_MS = 20_000;

/** Retry-After is seconds or an HTTP date. */
export function retryAfterMs(header: string | null, nowMs: number): number {
  if (!header) return DEFAULT_RETRY_MS;
  const secs = Number(header);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - nowMs;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_MS) : DEFAULT_RETRY_MS;
}

/**
 * intervals.icu over its REST API, as one athlete: a personal key (Basic auth, user "API_KEY") or an
 * OAuth bearer token. Built per athlete by the integration resolver (`integrations.ts`). The
 * source of training data (DECISIONS #13), read by the sync into our own collections (#49) — screens
 * and the coach never call it live, so there is no read cache here.
 *
 * Every request goes through one `RequestGate`. A 429 pauses the gate for its Retry-After and the
 * request is tried once more; a second 429 is thrown, and background work stops until next time.
 */
export class IntervalsIcu {
  private readonly base: string;
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;
  readonly gate: RequestGate;

  constructor(private readonly opts: IntervalsIcuOptions) {
    this.base = `${opts.baseUrl ?? 'https://intervals.icu'}/api/v1`;
    this.auth =
      opts.auth.kind === 'apiKey' ? `Basic ${Buffer.from(`API_KEY:${opts.auth.key}`).toString('base64')}` : `Bearer ${opts.auth.token}`;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.gate = opts.gate ?? new RequestGate({ minIntervalMs: INTERVALS_MIN_INTERVAL_MS });
  }

  private get athletePath() {
    return `/athlete/${encodeURIComponent(this.opts.athleteId ?? '0')}`;
  }

  /** One paced request, retried once after a 429. Errors are mapped to `IntervalsError`. */
  private async send(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown; accept?: string }): Promise<Response> {
    const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : '';
    const url = `${this.base}${path}${qs}`;
    const attempt = () =>
      this.gate.run(async () => {
        try {
          return await this.fetchFn(url, {
            method,
            headers: {
              Authorization: this.auth,
              Accept: opts.accept ?? 'application/json',
              ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (err) {
          throw new IntervalsError(`intervals.icu unreachable: ${(err as Error).message}`);
        }
      });
    let res = await attempt();
    if (res.status === 429) {
      const wait = retryAfterMs(res.headers.get('retry-after'), Date.now());
      console.warn(`intervals.icu 429 on ${method} ${path} — pausing ${Math.round(wait / 1000)} s`);
      this.gate.pause(wait);
      res = await attempt();
      if (res.status === 429) {
        const again = retryAfterMs(res.headers.get('retry-after'), Date.now());
        this.gate.pause(again);
        throw new IntervalsError('intervals.icu rate limit hit — the sync will pick up later.', 429, new Date(Date.now() + again));
      }
    }
    if (res.status === 401 || res.status === 403) throw new IntervalsError(
        this.opts.auth.kind === 'apiKey'
          ? 'intervals.icu rejected the API key — check it, then Sync now.'
          : 'intervals.icu rejected the connection — reconnect intervals.icu.',
        res.status,
      );
    if (res.status === 404) throw new IntervalsError('Not found on intervals.icu.', 404);
    if (!res.ok) throw new IntervalsError(`intervals.icu error ${res.status}`, res.status);
    return res;
  }

  private async request<T>(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const text = await (await this.send(method, path, opts)).text();
    return (text ? JSON.parse(text) : null) as T;
  }

  // ── Training data (read by the sync) ──────────────────────────────────────

  async listActivities(start: IsoDate, end: IsoDate): Promise<Activity[]> {
    const raw = await this.request<unknown>('GET', `${this.athletePath}/activities`, {
      query: { oldest: start, newest: `${end}T23:59:59` },
    });
    return mapActivities(raw);
  }

  /** One ride with its detected intervals. */
  async activityDetail(id: string): Promise<Omit<ActivityDetail, 'powerCurve'>> {
    const raw = await this.request<Record<string, unknown>>('GET', `/activity/${encodeURIComponent(id)}`, { query: { intervals: 'true' } });
    const activity = mapActivity(raw);
    if (!activity) throw new IntervalsError(`Activity ${id} not found.`, 404);
    const intervals = (Array.isArray(raw['icu_intervals']) ? raw['icu_intervals'] : []).map(mapInterval).filter((i) => i !== null);
    return { activity, intervals };
  }

  /** A ride's best power for standard durations. */
  async activityPowerCurve(id: string): Promise<PowerPoint[]> {
    return mapCurvePoints(await this.request('GET', `/activity/${encodeURIComponent(id)}/power-curve.json`), CURVE_DURATIONS);
  }

  async powerCurves(periods: readonly PowerCurvePeriod[]): Promise<PowerCurve[]> {
    const raw = await this.request<unknown>('GET', `${this.athletePath}/power-curves.json`, {
      query: { type: 'Ride', curves: periods.map((p) => CURVE_IDS[p]).join(',') },
    });
    return mapPowerCurves(raw);
  }

  /** Wellness per day: CTL/ATL, weigh-in, steps. */
  async wellness(start: IsoDate, end: IsoDate): Promise<WellnessDay[]> {
    const raw = await this.request<unknown>('GET', `${this.athletePath}/wellness.json`, { query: { oldest: start, newest: end } });
    return mapWellnessDays(raw);
  }

  /** Planned workouts and races on the intervals.icu calendar. */
  async listEvents(start: IsoDate, end: IsoDate): Promise<RemoteEvent[]> {
    const raw = await this.request<unknown>('GET', `${this.athletePath}/events.json`, {
      query: { oldest: start, newest: end, category: SYNCED_CATEGORIES.join(',') },
    });
    return mapRemoteEvents(raw);
  }

  /** A planned workout as Zwift XML, for importing workouts created in intervals.icu. */
  async downloadEventZwo(eventId: number): Promise<string> {
    return (await this.send('GET', `${this.athletePath}/events/${eventId}/download.zwo`, { accept: '*/*' })).text();
  }

  /** The athlete record and whether Zwift is connected. Throws; the sync stores the result. */
  async athlete(): Promise<{ athleteId?: string; zwiftConnected: boolean; ftp?: number }> {
    const athlete = await this.request<Record<string, unknown>>('GET', this.athletePath);
    const connections = await this.request<Record<string, unknown>>('GET', `${this.athletePath}/connections`);
    const rideSettings = (Array.isArray(athlete['sportSettings']) ? athlete['sportSettings'] : []).find(
      (s: { types?: string[] }) => s.types?.includes('Ride'),
    ) as { ftp?: number } | undefined;
    return {
      ...(typeof athlete['id'] === 'string' ? { athleteId: athlete['id'] } : {}),
      zwiftConnected: connections['zwift_connected'] === true,
      ...(typeof rideSettings?.ftp === 'number' ? { ftp: rideSettings.ftp } : {}),
    };
  }

  /** Live status, for the seed and smoke scripts. The app reads the stored copy instead. */
  async status(): Promise<IntegrationStatus> {
    try {
      return { status: 'connected', ...(await this.athlete()) };
    } catch (err) {
      return { status: 'error', lastError: (err as Error).message };
    }
  }

  // ── Calendar (planned workouts → Zwift) ───────────────────────────────────

  /**
   * Create an event. Not idempotent on its own (intervals.icu assigns the uid); a create whose
   * response was lost is recognised on the next sync by its `external_id` and adopted.
   */
  async createEvent(body: Record<string, unknown>): Promise<{ id: number; uid?: string | undefined; updated?: string | undefined }> {
    const res = await this.request<{ id?: number; uid?: string; updated?: string }>('POST', `${this.athletePath}/events`, {
      query: { upsertOnUid: 'false' },
      body,
    });
    if (typeof res?.id !== 'number') throw new IntervalsError('intervals.icu did not return an event id.');
    return { id: res.id, uid: res.uid, updated: res.updated };
  }

  async updateEvent(eventId: number, body: Record<string, unknown>): Promise<{ updated?: string | undefined }> {
    const res = await this.request<{ updated?: string } | null>('PUT', `${this.athletePath}/events/${eventId}`, { body });
    return { updated: res?.updated };
  }

  async deleteEvent(eventId: number): Promise<void> {
    try {
      await this.request('DELETE', `${this.athletePath}/events/${eventId}`);
    } catch (err) {
      // Already gone on their side (deleted in intervals.icu or Zwift) — that's the goal anyway.
      if (!(err instanceof IntervalsError && err.status === 404)) throw err;
    }
  }
}
