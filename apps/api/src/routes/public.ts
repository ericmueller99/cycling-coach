import type { SharedRecipe } from '@cycling-coach/shared';
import { Hono } from 'hono';
import type { ServiceFailure } from '../app';

/** What anyone with a link may read, signed in or not (DECISIONS #48). */
export interface PublicServices {
  recipe(token: string): Promise<SharedRecipe | ServiceFailure>;
}

const isFailure = (r: object): r is ServiceFailure => 'error' in r && 'status' in r;

/**
 * `/api/public/*` — mounted in `app.ts` BEFORE the guarded `/api` router, so these answer without
 * a session. Nothing here may read the viewer's session or return ids.
 */
export function publicRoutes(pub: PublicServices) {
  return new Hono().get('/recipes/:token', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    const r = await pub.recipe(c.req.param('token'));
    return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
  });
}
