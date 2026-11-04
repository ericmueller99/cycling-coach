import { describe, expect, it, vi } from 'vitest';
import { RequestGate } from '../gate';
import { IntervalsError, IntervalsIcu, isTransient, retryAfterMs, UNSHARED_STATUS } from './index';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(handler: (url: string, init: RequestInit) => Reply) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const { status, body, headers } = handler(String(url), init ?? {});
    return new Response(body === undefined ? '' : JSON.stringify(body), { status, ...(headers ? { headers } : {}) });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** A gate on a fake clock: no real waiting, and every wait is recorded. */
function fakeGate(minIntervalMs = 1000) {
  let t = 0;
  const sleeps: number[] = [];
  const gate = new RequestGate({
    minIntervalMs,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  return { gate, sleeps };
}

const make = (fetchFn: typeof fetch, gate = fakeGate().gate) => new IntervalsIcu({ auth: { kind: 'apiKey', key: 'secret' }, athleteId: '0', fetchFn, gate });
const calls = (fetchFn: unknown) => (fetchFn as { mock: { calls: [string, RequestInit][] } }).mock.calls;

describe('IntervalsIcu client', () => {
  it('sends Basic auth as API_KEY and maps 401 to a key error', async () => {
    const fetchFn = fakeFetch(() => ({ status: 401 }));
    await expect(make(fetchFn).wellness('2026-10-30', '2026-10-30')).rejects.toThrow(/rejected the API key/);
    const init = calls(fetchFn)[0]![1];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Basic ${Buffer.from('API_KEY:secret').toString('base64')}`);
  });

  it('sends an OAuth token as Bearer, defaults to athlete "0", and asks to reconnect on 403', async () => {
    const fetchFn = fakeFetch(() => ({ status: 403 }));
    const icu = new IntervalsIcu({ auth: { kind: 'bearer', token: 'tok' }, fetchFn, gate: fakeGate().gate });
    await expect(icu.wellness('2026-10-30', '2026-10-30')).rejects.toThrow(/reconnect intervals.icu/);
    const [url, init] = calls(fetchFn)[0]!;
    expect(url).toContain('/api/v1/athlete/0/wellness');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('revokes an OAuth token at disconnect-app', async () => {
    const fetchFn = fakeFetch(() => ({ status: 200 }));
    const icu = new IntervalsIcu({ auth: { kind: 'bearer', token: 'tok' }, fetchFn, gate: fakeGate().gate });
    await icu.disconnectApp();
    const [url, init] = calls(fetchFn)[0]!;
    expect(url).toBe('https://intervals.icu/api/v1/disconnect-app');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('paces every request through the gate, a second apart, with no read cache', async () => {
    const fetchFn = fakeFetch(() => ({ status: 200, body: [] }));
    const { gate, sleeps } = fakeGate(1000);
    const icu = make(fetchFn, gate);
    await Promise.all([icu.wellness('2026-10-30', '2026-10-30'), icu.wellness('2026-10-30', '2026-10-30'), icu.listActivities('2026-10-30', '2026-10-30')]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('waits out a 429 for its Retry-After and tries once more', async () => {
    let n = 0;
    const fetchFn = fakeFetch(() => (n++ === 0 ? { status: 429, headers: { 'Retry-After': '30' } } : { status: 200, body: [{ id: '2026-10-30', ctl: 60, atl: 50 }] }));
    const { gate, sleeps } = fakeGate(1000);
    const days = await make(fetchFn, gate).wellness('2026-10-30', '2026-10-30');
    expect(days).toEqual([{ date: '2026-10-30', ctl: 60, atl: 50 }]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([30_000]);
  });

  it('gives up after a second 429, as a transient error with when to come back', async () => {
    const fetchFn = fakeFetch(() => ({ status: 429 }));
    const err = await make(fetchFn).listActivities('2026-10-01', '2026-10-30').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntervalsError);
    expect((err as IntervalsError).status).toBe(429);
    expect((err as IntervalsError).retryAt).toBeInstanceOf(Date);
    expect(isTransient(err)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reads Retry-After as seconds or a date, and caps it', () => {
    expect(retryAfterMs('30', 0)).toBe(30_000);
    expect(retryAfterMs(null, 0)).toBe(60_000);
    expect(retryAfterMs('garbage', 0)).toBe(60_000);
    expect(retryAfterMs('86400', 0)).toBe(15 * 60_000);
    expect(retryAfterMs(new Date(120_000).toUTCString(), 0)).toBe(120_000);
  });

  it('includes the whole end day when listing activities', async () => {
    const fetchFn = fakeFetch(() => ({ status: 200, body: [] }));
    await make(fetchFn).listActivities('2026-10-16', '2026-10-30');
    expect(calls(fetchFn)[0]![0]).toBe('https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-10-16&newest=2026-10-30T23%3A59%3A59');
  });

  it('tells a hidden ride from a deleted one', async () => {
    const fetchFn = fakeFetch(() => ({ status: 200, body: { id: 'i1', _note: 'not available via the API' } }));
    const err = await make(fetchFn).activityDetail('i1').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: UNSHARED_STATUS });
  });

  it('treats deleting an already-deleted event as done', async () => {
    await expect(make(fakeFetch(() => ({ status: 404 }))).deleteEvent(7)).resolves.toBeUndefined();
    await expect(make(fakeFetch(() => ({ status: 500 }))).deleteEvent(7)).rejects.toBeInstanceOf(IntervalsError);
  });

  it('reports status without throwing', async () => {
    const status = await make(fakeFetch(() => ({ status: 401 }))).status();
    expect(status.status).toBe('error');
  });

  it('only waits out rate limits and outages, not a bad key', () => {
    expect(isTransient(new IntervalsError('x', 503))).toBe(true);
    expect(isTransient(new IntervalsError('unreachable'))).toBe(true);
    expect(isTransient(new IntervalsError('x', 401))).toBe(false);
  });
});
