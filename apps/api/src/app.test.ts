import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppServices } from './app';
import { authConfig, type Auth } from './auth';
import { loadEnv } from './lib/env';

describe('manual intervals.icu syncs (DECISIONS #75)', () => {
  const auth = { api: { getSession: async () => ({ user: { id: 'u1' }, session: {} }) }, handler: () => new Response(null, { status: 404 }) } as unknown as Auth;
  const env = loadEnv({ MONGO_DB_URI: 'mongodb://x', BETTER_AUTH_SECRET: 'x'.repeat(32) });
  const make = (retryAt: Date | null) => {
    const sync = vi.fn(async () => ({}));
    const fullSync = vi.fn(async () => ({}));
    const services = { intervals: { status: async () => ({ status: 'connected' }), retryAt: () => retryAt, sync, fullSync } } as unknown as AppServices;
    return { app: createApp({ auth, authConfig: authConfig(), env, services }), sync, fullSync };
  };
  const post = (app: ReturnType<typeof make>['app'], path: string) => app.request(`/api/integrations/intervals/${path}`, { method: 'POST' });

  it('runs when the limit allows', async () => {
    const { app, sync, fullSync } = make(null);
    expect((await post(app, 'sync')).status).toBe(200);
    expect((await post(app, 'full-sync')).status).toBe(202);
    expect(sync).toHaveBeenCalledOnce();
    expect(fullSync).toHaveBeenCalledOnce();
  });

  it('refuses inside the limit, says when, and spends nothing', async () => {
    const at = new Date('2026-11-03T12:05:00Z');
    const { app, sync, fullSync } = make(at);
    const res = await post(app, 'sync');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { retryAt: string }).retryAt).toBe(at.toISOString());
    expect((await post(app, 'full-sync')).status).toBe(409);
    expect(sync).not.toHaveBeenCalled();
    expect(fullSync).not.toHaveBeenCalled();
  });
});

describe('listing chats', () => {
  const auth = { api: { getSession: async () => ({ user: { id: 'u1' }, session: {} }) }, handler: () => new Response(null, { status: 404 }) } as unknown as Auth;
  const env = loadEnv({ MONGO_DB_URI: 'mongodb://x', BETTER_AUTH_SECRET: 'x'.repeat(32) });
  const make = () => {
    const list = vi.fn(async () => []);
    return { app: createApp({ auth, authConfig: authConfig(), env, services: { threads: { list } } as unknown as AppServices }), list };
  };

  it('uses the default with no limit, and the limit it is given', async () => {
    const { app, list } = make();
    expect((await app.request('/api/threads')).status).toBe(200);
    expect(list).toHaveBeenLastCalledWith('u1', undefined);
    await app.request('/api/threads?limit=100');
    expect(list).toHaveBeenLastCalledWith('u1', 100);
  });

  it('caps a big limit and refuses a bad one', async () => {
    const { app, list } = make();
    await app.request('/api/threads?limit=999');
    expect(list).toHaveBeenLastCalledWith('u1', 500);
    for (const limit of ['0', '-1', 'abc', '1000']) expect((await app.request(`/api/threads?limit=${limit}`)).status).toBe(400);
  });
});

/** The share page's API answers without a session; everything else under /api still needs one. */
describe('public routes', () => {
  const auth = { api: { getSession: async () => null }, handler: () => new Response(null, { status: 404 }) } as unknown as Auth;
  const env = loadEnv({ MONGO_DB_URI: 'mongodb://x', BETTER_AUTH_SECRET: 'x'.repeat(32) });
  const services = {
    public: {
      recipe: async (token: string) =>
        token === 'ok'
          ? { view: { name: 'Bowl', servings: 2, ingredients: [], toTaste: [], steps: [], perServing: { kcal: 1, fat: 0, carbs: 0, protein: 0 }, uncounted: 0 }, sharedBy: 'Sam', updatedAt: '' }
          : { error: 'This link was turned off.', status: 410 as const },
    },
  } as unknown as AppServices;
  const app = createApp({ auth, authConfig: authConfig(), env, services });

  it('serves a shared recipe with no cookie, uncached and unindexed', async () => {
    const res = await app.request('/api/public/recipes/ok');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(((await res.json()) as { sharedBy: string }).sharedBy).toBe('Sam');
  });
  it('passes the service status through', async () => {
    expect((await app.request('/api/public/recipes/gone')).status).toBe(410);
  });
  it('keeps the rest of /api behind the guard', async () => {
    expect((await app.request('/api/me')).status).toBe(401);
    expect((await app.request('/api/food/recipes/x')).status).toBe(401);
    expect((await app.request('/api/public/other')).status).toBe(401);
  });
});

describe('auth config', () => {
  const auth = { api: { getSession: async () => null }, handler: () => new Response(null, { status: 404 }) } as unknown as Auth;
  const env = loadEnv({ MONGO_DB_URI: 'mongodb://x', BETTER_AUTH_SECRET: 'x'.repeat(32) });
  const get = async (config: ReturnType<typeof authConfig>) => (await createApp({ auth, authConfig: config, env, services: {} as AppServices }).request('/api/auth-config')).json();

  it('is public, and says what this server offers', async () => {
    // Self-host: the seed makes the one account, and there's no email.
    expect(await get(authConfig())).toEqual({ signUp: false, passwordReset: false, emailVerification: false });
    const send = async () => {};
    expect(
      await get(
        authConfig({
          allowSignUp: true,
          options: { emailAndPassword: { enabled: true, sendResetPassword: send }, emailVerification: { sendVerificationEmail: send } },
        }),
      ),
    ).toEqual({ signUp: true, passwordReset: true, emailVerification: true });
  });
});
