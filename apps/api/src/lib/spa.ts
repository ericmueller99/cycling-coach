import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Hono } from 'hono';

/**
 * Serve a built SPA from `dist` beside the API (one container, one origin — DECISIONS #5). The
 * home-screen app stays open across deploys (#43): the shell is always revalidated, hashed assets
 * are cached forever, and the manifest/icons briefly. Client-side routes fall back to the shell;
 * unknown /api paths 404, and so do missing /assets/* files — an old chunk requested after a deploy
 * must fail as a 404 (which the SPA recovers from by reloading), not come back as index.html.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Hono app, whatever its routes' types
export function serveSpa(app: Hono<any, any, any>, dist: string): void {
  const noCache = (_: string, ctx: Context) => ctx.header('Cache-Control', 'no-cache');
  const cacheFor = (path: string, ctx: Context) =>
    ctx.header(
      'Cache-Control',
      /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : /\.html$/.test(path) ? 'no-cache' : 'public, max-age=3600',
    );
  app.use('/*', serveStatic({ root: dist, onFound: cacheFor }));
  app.get('*', async (ctx, next) =>
    ctx.req.path.startsWith('/api') || ctx.req.path.startsWith('/assets/') ? next() : serveStatic({ path: `${dist}/index.html`, onFound: noCache })(ctx, next),
  );
}
