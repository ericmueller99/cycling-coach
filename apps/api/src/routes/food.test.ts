import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { ServiceFailure } from '../app';
import { foodRoutes, type FoodServices } from './food';

const refused: ServiceFailure = { error: 'Your trial has ended.', status: 402, action: { label: 'Subscribe', href: '/billing' } };

function app(failure: ServiceFailure) {
  const food = { parse: async () => failure, readPhoto: async () => failure, adjust: async () => failure } as unknown as FoodServices;
  return new Hono<{ Variables: { user: { id: string } } }>()
    .use('*', async (c, next) => {
      c.set('user', { id: 'user-1' });
      await next();
    })
    .route('/', foodRoutes(food));
}

const post = (a: ReturnType<typeof app>, path: string, body: unknown) =>
  a.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const parse = { phrase: '2 eggs on toast', date: '2026-11-04', slot: 'Breakfast' };
const adjust = { food: { name: 'Mocha', nutrients: { kcal: 370 } }, turns: [], message: 'no whipped cream' };
const photo = { images: [{ data: 'a'.repeat(200), mediaType: 'image/jpeg' }] };

describe('a refused AI call (DECISIONS #76)', () => {
  it('passes on the way forward when parsing words', async () => {
    const res = await post(app(refused), '/parse', parse);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: refused.error, action: refused.action });
  });

  it('passes on the way forward when reading a photo', async () => {
    const res = await post(app(refused), '/photo', photo);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: refused.error, action: refused.action });
  });

  it('passes on the way forward when adjusting a food', async () => {
    const res = await post(app(refused), '/adjust', adjust);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: refused.error, action: refused.action });
  });

  it('adds nothing to an ordinary failure', async () => {
    const res = await post(app({ error: 'AI is off here.', status: 503 }), '/parse', parse);
    expect(await res.json()).toEqual({ error: 'AI is off here.' });
  });
});

describe('POST /intro-seen', () => {
  it('marks it for the signed-in user', async () => {
    const seen: string[] = [];
    const food = { markIntroSeen: async (userId: string) => void seen.push(userId) } as unknown as FoodServices;
    const a = new Hono<{ Variables: { user: { id: string } } }>()
      .use('*', async (c, next) => {
        c.set('user', { id: 'user-1' });
        await next();
      })
      .route('/', foodRoutes(food));
    const res = await a.request('/intro-seen', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(seen).toEqual(['user-1']);
  });
});
