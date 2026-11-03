import { describe, expect, it } from 'vitest';
import { createApp, type AppServices } from './app';
import type { Auth } from './auth';
import { loadEnv } from './lib/env';

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
  const app = createApp({ auth, env, services });

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
