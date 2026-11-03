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
  fetchFn?: typeof fetch;
}

/**
 * Per-athlete integration clients (DECISIONS #53). Every service that talks to intervals.icu or
 * Zwift asks here with a `userId`, never holds a client of its own — a single server-wide client is
 * how one athlete's key once synced into every account.
 *
 * Clients are cached per user so a Zwift token (and its "password rejected, don't retry" flag)
 * survives between calls. `invalidate` drops a user's client when their credentials change.
 */
export class IntegrationResolver {
  readonly intervalsGate: RequestGate;
  readonly zwiftGate: RequestGate;
  private readonly intervalsClients = new Map<string, Promise<IntervalsIcu | null>>();
  private readonly zwiftClients = new Map<string, Promise<ZwiftClient | null>>();

  constructor(
    private readonly source: CredentialSource,
    private readonly opts: IntegrationResolverOptions = {},
  ) {
    this.intervalsGate = opts.intervalsGate ?? new RequestGate({ minIntervalMs: INTERVALS_MIN_INTERVAL_MS });
    this.zwiftGate = opts.zwiftGate ?? new RequestGate({ minIntervalMs: ZWIFT_MIN_INTERVAL_MS });
  }

  intervalsFor(userId: string): Promise<IntervalsIcu | null> {
    return cached(this.intervalsClients, userId, async () => {
      const creds = await this.source.intervals(userId);
      if (!creds) return null;
      const { athleteId, ...auth } = creds;
      return new IntervalsIcu({
        auth,
        athleteId,
        gate: this.intervalsGate,
        ...(this.opts.fetchFn ? { fetchFn: this.opts.fetchFn } : {}),
      });
    });
  }

  zwiftFor(userId: string): Promise<ZwiftClient | null> {
    return cached(this.zwiftClients, userId, async () => {
      const creds = await this.source.zwift(userId);
      return creds ? new ZwiftClient({ ...creds, gate: this.zwiftGate, ...(this.opts.fetchFn ? { fetchFn: this.opts.fetchFn } : {}) }) : null;
    });
  }

  /** Forget a user's client(s) — after they connect, reconnect or disconnect. */
  invalidate(userId: string, provider?: Provider) {
    if (!provider || provider === 'intervals_icu') this.intervalsClients.delete(userId);
    if (!provider || provider === 'zwift') this.zwiftClients.delete(userId);
  }
}

/** A failed lookup isn't cached, so the next call tries again. */
function cached<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit) return hit;
  const p = make();
  map.set(key, p);
  p.catch(() => map.delete(key));
  return p;
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
