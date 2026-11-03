import type { Features } from '@cycling-coach/shared';
import { RequestGate } from './providers/gate';
import { IntervalsIcu, INTERVALS_MIN_INTERVAL_MS, type IntervalsAuth } from './providers/intervals-icu';
import { ZWIFT_MIN_INTERVAL_MS, ZwiftClient } from './providers/zwift';

export type Provider = 'intervals_icu' | 'zwift';

/** Runs `fn` with nobody else holding the same lock. The server's spans processes (DECISIONS #56). */
export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

/** One holder at a time within this process — the default where no shared lock is wired. */
export function localLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>) => {
    const next = tail.catch(() => {}).then(fn);
    tail = next;
    return next;
  };
}

/** One athlete's intervals.icu access: a personal API key or an OAuth token, plus their athlete id. */
export type IntervalsCredentials = IntervalsAuth & { athleteId?: string | undefined };
export interface ZwiftCredentials {
  username: string;
  password: string;
}

/**
 * Where an athlete's credentials come from. Self-host reads the server's env vars and gives them to
 * the owner account only (`envCredentials`); the hosted version reads each user's stored, encrypted
 * credentials. `null` means "not connected" — for that user, not for the whole server.
 */
export interface CredentialSource {
  intervals(userId: string): Promise<IntervalsCredentials | null>;
  zwift(userId: string): Promise<ZwiftCredentials | null>;
}

export interface IntegrationResolverOptions {
  /** Shared by every athlete's intervals.icu client: its limits are per app and per IP (DECISIONS #53). */
  intervalsGate?: RequestGate;
  /** Shared by every Zwift client and the public feed: one request every 2 s in total (DECISIONS #29). */
  zwiftGate?: RequestGate;
  /** Another intervals.icu, for a local stand-in. */
  intervalsBaseUrl?: string | undefined;
  fetchFn?: typeof fetch;
}

/**
 * Per-athlete integration clients (DECISIONS #53). Every service that talks to intervals.icu or
 * Zwift asks here with a `userId`, never holds a client of its own — a single server-wide client is
 * how one athlete's key once synced into every account.
 *
 * Every lookup asks the credential source, and a user's client is reused only while their
 * credentials are unchanged (DECISIONS #60). So a Zwift token (and its "password rejected, don't
 * retry" flag) survives between calls, and a login changed in another process (the API, the worker,
 * an admin script) takes effect on the next lookup everywhere. `invalidate` is the local fast path.
 */
export class IntegrationResolver {
  readonly intervalsGate: RequestGate;
  readonly zwiftGate: RequestGate;
  private readonly intervalsClients = new Map<string, Cached<IntervalsIcu>>();
  private readonly zwiftClients = new Map<string, Cached<ZwiftClient>>();

  constructor(
    private readonly source: CredentialSource,
    private readonly opts: IntegrationResolverOptions = {},
  ) {
    this.intervalsGate = opts.intervalsGate ?? new RequestGate({ minIntervalMs: INTERVALS_MIN_INTERVAL_MS });
    this.zwiftGate = opts.zwiftGate ?? new RequestGate({ minIntervalMs: ZWIFT_MIN_INTERVAL_MS });
  }

  async intervalsFor(userId: string): Promise<IntervalsIcu | null> {
    const creds = await this.source.intervals(userId);
    return reuse(this.intervalsClients, userId, creds, ({ athleteId, ...auth }) =>
      new IntervalsIcu({
        auth,
        athleteId,
        gate: this.intervalsGate,
        ...(this.opts.intervalsBaseUrl ? { baseUrl: this.opts.intervalsBaseUrl } : {}),
        ...(this.opts.fetchFn ? { fetchFn: this.opts.fetchFn } : {}),
      }),
    );
  }

  async zwiftFor(userId: string): Promise<ZwiftClient | null> {
    const creds = await this.source.zwift(userId);
    return reuse(this.zwiftClients, userId, creds, (c) => new ZwiftClient({ ...c, gate: this.zwiftGate, ...(this.opts.fetchFn ? { fetchFn: this.opts.fetchFn } : {}) }));
  }

  /** Forget a user's client(s) — after they connect, reconnect or disconnect. */
  invalidate(userId: string, provider?: Provider) {
    if (!provider || provider === 'intervals_icu') this.intervalsClients.delete(userId);
    if (!provider || provider === 'zwift') this.zwiftClients.delete(userId);
  }
}

interface Cached<C> {
  /** The credentials the client was built from, serialized; in memory only. */
  key: string;
  client: C;
}

/**
 * The cached client while `creds` match what it was built from, else a new one; none when not
 * connected. Check and store happen in one tick after the lookup, so concurrent callers share a client.
 * A failed lookup throws before this and caches nothing.
 */
function reuse<T extends object, C>(map: Map<string, Cached<C>>, userId: string, creds: T | null, make: (creds: T) => C): C | null {
  if (!creds) {
    map.delete(userId);
    return null;
  }
  const key = JSON.stringify(creds);
  const hit = map.get(userId);
  if (hit?.key === key) return hit.client;
  const client = make(creds);
  map.set(userId, { key, client });
  return client;
}

export interface EnvCredentialsOptions {
  intervalsKey?: string | undefined;
  intervalsAthleteId?: string | undefined;
  zwiftUsername?: string | undefined;
  zwiftPassword?: string | undefined;
  /** The account the server's credentials belong to. */
  ownerId: () => Promise<string | null>;
}

/**
 * Self-host: the server's INTERVALS_ICU_KEY and ZWIFT_* belong to the owner account (OWNER_EMAIL,
 * else the oldest account). Every other account is "not connected", so a second account can never
 * sync the owner's rides into itself.
 */
export function envCredentials(opts: EnvCredentialsOptions): CredentialSource {
  const isOwner = async (userId: string) => (await opts.ownerId()) === userId;
  return {
    intervals: async (userId) =>
      opts.intervalsKey && (await isOwner(userId)) ? { kind: 'apiKey', key: opts.intervalsKey, athleteId: opts.intervalsAthleteId } : null,
    zwift: async (userId) =>
      opts.zwiftUsername && opts.zwiftPassword && (await isOwner(userId)) ? { username: opts.zwiftUsername, password: opts.zwiftPassword } : null,
  };
}

/**
 * What an account may use (DECISIONS #54). The credential source enforces the same rule — a hosted
 * account without the `zwift` flag gets no Zwift client — and this tells the UI what to offer.
 */
export interface FeatureSource {
  forUser(userId: string): Promise<Features>;
}

/** Self-host: the owner may use everything; other accounts get none of the owner-bound features. */
export function envFeatures(ownerId: () => Promise<string | null>): FeatureSource {
  return { forUser: async (userId) => ({ zwiftAccount: (await ownerId()) === userId }) };
}

/**
 * Remembers the owner once found. Until the first account exists (a fresh self-host before the seed
 * or sign-up), it keeps looking.
 */
export function memoOwner(find: () => Promise<string | null>): () => Promise<string | null> {
  let owner: Promise<string | null> | null = null;
  return async () => {
    owner ??= find();
    const id = await owner.catch(() => null);
    if (!id) owner = null;
    return id;
  };
}
