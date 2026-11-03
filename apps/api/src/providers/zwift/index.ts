import { RequestGate } from '../gate';
import { mapZwift, type ZwiftSnapshot } from './map';
export type { ZwiftSnapshot } from './map';
export { RequestGate } from '../gate';

/** All Zwift traffic: 1 request every 2 s, one in flight. */
export const ZWIFT_MIN_INTERVAL_MS = 2_000;
export { ZwiftPublic } from './public';

export interface ZwiftClientOptions {
  username: string;
  password: string;
  /** Shared with every other Zwift caller (DECISIONS #29). Tests pass one with no spacing. */
  gate?: RequestGate;
  /** One line per request (path, status, ms) — never tokens. */
  log?: (line: string) => void;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

/** One page of the logged-in event feed. `cursor` is absent on the last page. */
export interface EventFeedPage {
  events: unknown[];
  cursor?: string | undefined;
}

export class ZwiftError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface Token {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt: number;
  refreshExpiresAt: number;
}

const AUTH_URL = 'https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/token';
const API = 'https://us-or-rly101.zwift.com';
const CLIENT_ID = 'Zwift Game Client';
const TIMEOUT_MS = 20_000;
/** The most `event-feed` accepts (100 and 200 are refused, measured 2026-10-31). */
export const EVENT_FEED_LIMIT = 50;
/** Renew this long before the token actually expires. */
const SKEW_MS = 60_000;

/**
 * Zwift's unofficial game API, logged in as the athlete (DECISIONS #23). Read-only: zFTP, zMAP, weight,
 * FTP, category, Racing Score (`/api/profiles/me`, `/api/power-curve/power-profile`, `/api/profiles/{id}`),
 * and the event feed for "Get more events" (DECISIONS #29). Against Zwift's terms and liable to
 * break, so everything that uses it degrades. This folder is the only code in the app that talks to
 * Zwift, and every request goes through the shared `RequestGate`.
 *
 * Credentials and tokens are never logged. After Zwift rejects the password the client refuses to
 * try again until `reset()` (a manual sync) — repeated bad logins can lock the account.
 */
export class ZwiftClient {
  private token: Token | null = null;
  private rejected: string | null = null;
  private pending: Promise<string> | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly gate: RequestGate;
  private readonly log: (line: string) => void;

  constructor(private readonly opts: ZwiftClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.gate = opts.gate ?? new RequestGate({ minIntervalMs: ZWIFT_MIN_INTERVAL_MS });
    this.log = opts.log ?? ((line) => console.log(line));
  }

  /** Allow a login again after a rejected password. */
  reset() {
    this.rejected = null;
  }

  async metrics(): Promise<ZwiftSnapshot> {
    const [profile, powerProfile] = await Promise.all([
      this.get('/api/profiles/me'),
      // zFTP is the point, but a missing power profile shouldn't lose the weight and FTP.
      this.get('/api/power-curve/power-profile').catch((err: ZwiftError) => (err.status === 404 ? null : Promise.reject(err))),
    ]);
    // Racing Score is only on the profile fetched by id; losing it mustn't lose the rest.
    const id = (profile as { id?: unknown } | null)?.id;
    const publicProfile = typeof id === 'number' || typeof id === 'string' ? await this.get(`/api/profiles/${id}`).catch(() => null) : null;
    return mapZwift(profile, powerProfile, publicProfile);
  }

  /** One page of upcoming events between `from` and `to` (ms). The feed may run past `to`. */
  async eventFeedPage(p: { from: number; to: number; cursor?: string | undefined }): Promise<EventFeedPage> {
    const q = new URLSearchParams({ from: String(p.from), to: String(p.to), limit: String(EVENT_FEED_LIMIT) });
    if (p.cursor) q.set('cursor', p.cursor);
    const body = (await this.get(`/api/event-feed?${q}`)) as { data?: unknown; cursor?: unknown } | null;
    const data = Array.isArray(body?.data) ? body.data : [];
    return {
      events: data.map((d) => (d && typeof d === 'object' && 'event' in d ? (d as { event: unknown }).event : d)),
      cursor: typeof body?.cursor === 'string' && body.cursor ? body.cursor : undefined,
    };
  }

  private async get(path: string): Promise<unknown> {
    const res = await this.send(`${API}${path}`, { headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: 'application/json' } });
    if (res.status === 401) this.token = null; // Next call logs in again.
    if (!res.ok) throw new ZwiftError(`Zwift error ${res.status} on ${path}`, res.status);
    return res.json();
  }

  /** Concurrent requests share one login. */
  private accessToken(): Promise<string> {
    this.pending ??= this.obtainToken().finally(() => (this.pending = null));
    return this.pending;
  }

  private async obtainToken(): Promise<string> {
    const t = this.now().getTime();
    if (this.token && t < this.token.expiresAt) return this.token.accessToken;
    if (this.token?.refreshToken && t < this.token.refreshExpiresAt) {
      const refreshed = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.token.refreshToken }).catch(() => null);
      if (refreshed) return refreshed.accessToken;
    }
    if (this.rejected) throw new ZwiftError(this.rejected, 401);
    return (await this.tokenRequest({ grant_type: 'password', username: this.opts.username, password: this.opts.password })).accessToken;
  }

  private async tokenRequest(params: Record<string, string>): Promise<Token> {
    const res = await this.send(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body['access_token'] !== 'string') {
      this.token = null;
      if (params['grant_type'] === 'password' && (res.status === 400 || res.status === 401)) {
        this.rejected = `Zwift rejected the login (${String(body['error_description'] ?? body['error'] ?? res.status)}) — check ZWIFT_USERNAME / ZWIFT_PASSWORD, then Sync now.`;
        throw new ZwiftError(this.rejected, 401);
      }
      throw new ZwiftError(`Zwift login failed (${res.status})`, res.status);
    }
    const t = this.now().getTime();
    const secs = (k: string, fallback: number) => (typeof body[k] === 'number' ? (body[k] as number) : fallback);
    this.token = {
      accessToken: body['access_token'],
      refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : undefined,
      expiresAt: t + secs('expires_in', 300) * 1000 - SKEW_MS,
      refreshExpiresAt: t + secs('refresh_expires_in', 0) * 1000 - SKEW_MS,
    };
    return this.token;
  }

  private send(url: string, init: RequestInit): Promise<Response> {
    return this.gate.run(async () => {
      const started = Date.now();
      const path = new URL(url).pathname;
      try {
        const res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        this.log(`zwift ${init.method ?? 'GET'} ${path} → ${res.status} (${Date.now() - started} ms)`);
        return res;
      } catch (err) {
        this.log(`zwift ${init.method ?? 'GET'} ${path} failed (${Date.now() - started} ms)`);
        throw new ZwiftError(`Zwift unreachable: ${(err as Error).message}`);
      }
    });
  }
}
