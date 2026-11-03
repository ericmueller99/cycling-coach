import { describe, expect, it, vi } from 'vitest';
import { envCredentials, envFeatures, IntegrationResolver, memoOwner, type CredentialSource } from './integrations';

const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const env = (over: Partial<Parameters<typeof envCredentials>[0]> = {}) =>
  envCredentials({ intervalsKey: 'key', intervalsAthleteId: '0', zwiftUsername: 'u', zwiftPassword: 'p', ownerId: async () => OWNER, ...over });

describe('envCredentials (self-host)', () => {
  it("gives the server's credentials to the owner account only", async () => {
    const source = env();
    expect(await source.intervals(OWNER)).toEqual({ kind: 'apiKey', key: 'key', athleteId: '0' });
    expect(await source.zwift(OWNER)).toEqual({ username: 'u', password: 'p' });
    expect(await source.intervals(OTHER)).toBeNull();
    expect(await source.zwift(OTHER)).toBeNull();
  });

  it('is not connected for anyone when the env vars are unset, or before any account exists', async () => {
    expect(await env({ intervalsKey: undefined }).intervals(OWNER)).toBeNull();
    expect(await env({ zwiftPassword: undefined }).zwift(OWNER)).toBeNull();
    expect(await env({ ownerId: async () => null }).intervals(OWNER)).toBeNull();
  });
});

describe('memoOwner', () => {
  it('looks the owner up once, but keeps looking until there is one', async () => {
    const find = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValue(OWNER);
    const owner = memoOwner(find);
    expect(await owner()).toBeNull();
    expect(await owner()).toBe(OWNER);
    expect(await owner()).toBe(OWNER);
    expect(find).toHaveBeenCalledTimes(2);
  });
});

describe('IntegrationResolver', () => {
  const counting = (): CredentialSource & { calls: { intervals: number; zwift: number } } => {
    const calls = { intervals: 0, zwift: 0 };
    return {
      calls,
      intervals: async (userId) => (calls.intervals++, userId === OWNER ? { kind: 'bearer', token: 't', athleteId: 'i1' } : null),
      zwift: async (userId) => (calls.zwift++, userId === OWNER ? { username: 'u', password: 'p' } : null),
    };
  };

  it('builds one client per athlete and caches it, including "not connected"', async () => {
    const source = counting();
    const r = new IntegrationResolver(source);
    const a = await r.intervalsFor(OWNER);
    expect(a).not.toBeNull();
    expect(await r.intervalsFor(OWNER)).toBe(a);
    expect(await r.intervalsFor(OTHER)).toBeNull();
    expect(await r.intervalsFor(OTHER)).toBeNull();
    expect(source.calls.intervals).toBe(2);
    expect(await r.zwiftFor(OWNER)).toBe(await r.zwiftFor(OWNER));
    expect(source.calls.zwift).toBe(1);
  });

  it('shares one gate per provider across athletes', async () => {
    const r = new IntegrationResolver({
      intervals: async () => ({ kind: 'apiKey', key: 'k' }),
      zwift: async () => ({ username: 'u', password: 'p' }),
    });
    const [a, b] = await Promise.all([r.intervalsFor(OWNER), r.intervalsFor(OTHER)]);
    expect(a).not.toBe(b);
    expect(a!.gate).toBe(r.intervalsGate);
    expect(b!.gate).toBe(r.intervalsGate);
  });

  it('rebuilds after invalidate, for that provider only', async () => {
    const source = counting();
    const r = new IntegrationResolver(source);
    const before = await r.intervalsFor(OWNER);
    const zwift = await r.zwiftFor(OWNER);
    r.invalidate(OWNER, 'intervals_icu');
    expect(await r.intervalsFor(OWNER)).not.toBe(before);
    expect(await r.zwiftFor(OWNER)).toBe(zwift);
    r.invalidate(OWNER);
    expect(await r.zwiftFor(OWNER)).not.toBe(zwift);
  });

  it('does not cache a failed lookup', async () => {
    let fail = true;
    const r = new IntegrationResolver({
      intervals: async () => {
        if (fail) throw new Error('db down');
        return { kind: 'apiKey', key: 'k' };
      },
      zwift: async () => null,
    });
    await expect(r.intervalsFor(OWNER)).rejects.toThrow('db down');
    fail = false;
    expect(await r.intervalsFor(OWNER)).not.toBeNull();
  });
});

describe('envFeatures (self-host)', () => {
  it('lets the owner use the Zwift login features and nobody else', async () => {
    const features = envFeatures(async () => OWNER);
    expect(await features.forUser(OWNER)).toEqual({ zwiftAccount: true });
    expect(await features.forUser(OTHER)).toEqual({ zwiftAccount: false });
  });
});
