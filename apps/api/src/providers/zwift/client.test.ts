import { describe, expect, it, vi } from 'vitest';
import { RequestGate, ZwiftClient } from './index';

const quiet = { gate: new RequestGate({ minIntervalMs: 0 }), log: () => {} };

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };
function fakeFetch(handler: Handler) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(url), init ?? {});
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const calls = (f: unknown) => (f as { mock: { calls: [string, RequestInit][] } }).mock.calls;
const isAuth = (url: string) => url.includes('secure.zwift.com');
const token = { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, refresh_expires_in: 86400 };
const ok: Handler = (url) =>
  isAuth(url)
    ? { status: 200, body: token }
    : url.endsWith('/profiles/me')
      ? { status: 200, body: { id: 1000001, ftp: 345, competitionMetrics: null } }
      : url.endsWith('/profiles/1000001')
        ? { status: 200, body: { id: 1000001, competitionMetrics: { racingScore: 696 } } }
        : { status: 200, body: { zftp: 330 } };

describe('ZwiftClient', () => {
  it('logs in once with the game client id and reuses the token', async () => {
    const fetchFn = fakeFetch(ok);
    const zwift = new ZwiftClient({ ...quiet, username: 'e@x.com', password: 'pw', fetchFn });
    expect(await zwift.metrics()).toMatchObject({ zwiftId: '1000001', ftp: 345, zftp: 330, racingScore: 696 });
    await zwift.metrics();
    const auth = calls(fetchFn).filter(([u]) => isAuth(u));
    expect(auth).toHaveLength(1);
    const form = new URLSearchParams(String(auth[0]![1].body));
    expect(Object.fromEntries(form)).toEqual({ client_id: 'Zwift Game Client', grant_type: 'password', username: 'e@x.com', password: 'pw' });
    const api = calls(fetchFn).find(([u]) => u.endsWith('/api/profiles/me'))!;
    expect((api[1].headers as Record<string, string>)['Authorization']).toBe('Bearer a1');
  });

  it('refreshes an expired token instead of logging in again', async () => {
    let t = Date.parse('2026-10-30T12:00:00Z');
    const fetchFn = fakeFetch(ok);
    const zwift = new ZwiftClient({ ...quiet, username: 'u', password: 'p', fetchFn, now: () => new Date(t) });
    await zwift.metrics();
    t += 2 * 3600 * 1000;
    await zwift.metrics();
    const grants = calls(fetchFn).filter(([u]) => isAuth(u)).map(([, init]) => new URLSearchParams(String(init.body)).get('grant_type'));
    expect(grants).toEqual(['password', 'refresh_token']);
  });

  it('stops trying a rejected password until reset', async () => {
    const fetchFn = fakeFetch((url) => (isAuth(url) ? { status: 401, body: { error: 'invalid_grant', error_description: 'Invalid user credentials' } } : { status: 200, body: {} }));
    const zwift = new ZwiftClient({ ...quiet, username: 'u', password: 'wrong', fetchFn });
    await expect(zwift.metrics()).rejects.toThrow(/rejected the login \(Invalid user credentials\)/);
    await expect(zwift.metrics()).rejects.toThrow(/rejected the login/);
    expect(calls(fetchFn).filter(([u]) => isAuth(u))).toHaveLength(1);
    zwift.reset();
    await expect(zwift.metrics()).rejects.toThrow();
    expect(calls(fetchFn).filter(([u]) => isAuth(u))).toHaveLength(2);
  });

  it('still returns weight and FTP when the power profile 404s', async () => {
    const fetchFn = fakeFetch((url) => (url.includes('power-profile') ? { status: 404 } : ok(url, {})));
    expect(await new ZwiftClient({ ...quiet, username: 'u', password: 'p', fetchFn }).metrics()).toMatchObject({ ftp: 345, zftp: undefined });
  });

  it('still returns the rest when the by-id profile fails', async () => {
    const fetchFn = fakeFetch((url) => (url.endsWith('/profiles/1000001') ? { status: 500 } : ok(url, {})));
    expect(await new ZwiftClient({ ...quiet, username: 'u', password: 'p', fetchFn }).metrics()).toMatchObject({ ftp: 345, zftp: 330, racingScore: undefined });
  });

  it('reads one event-feed page through the gate, unwrapping {event}', async () => {
    const fetchFn = fakeFetch((url) =>
      isAuth(url) ? { status: 200, body: token } : { status: 200, body: { data: [{ event: { id: 1 } }, { event: { id: 2 } }], cursor: 'c2' } },
    );
    const page = await new ZwiftClient({ ...quiet, username: 'u', password: 'p', fetchFn }).eventFeedPage({ from: 1, to: 2, cursor: 'c1' });
    expect(page).toEqual({ events: [{ id: 1 }, { id: 2 }], cursor: 'c2' });
    const feed = calls(fetchFn).find(([u]) => u.includes('/api/event-feed'))![0];
    expect(Object.fromEntries(new URL(feed).searchParams)).toEqual({ from: '1', to: '2', limit: '50', cursor: 'c1' });
  });

  it('reports the last page with no cursor', async () => {
    const fetchFn = fakeFetch((url) => (isAuth(url) ? { status: 200, body: token } : { status: 200, body: { data: [], cursor: '' } }));
    expect(await new ZwiftClient({ ...quiet, username: 'u', password: 'p', fetchFn }).eventFeedPage({ from: 1, to: 2 })).toEqual({ events: [], cursor: undefined });
  });
});
