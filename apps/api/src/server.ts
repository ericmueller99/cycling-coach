import { serve } from '@hono/node-server';
import { createCore } from './compose';
import { loadEnv } from './lib/env';
import { serveSpa } from './lib/spa';

/**
 * The self-hosted server: the composition root with its defaults (DECISIONS #57), the built SPA in
 * production, and the job loop unless BACKGROUND_JOBS=false (local dev, which must not sync on its
 * own; its "Sync now" shares the scheduled run's lease either way — #56).
 */
const core = await createCore({ env: loadEnv(process.env) });
const { env, app } = core;

if (env.WEB_DIST) serveSpa(app, env.WEB_DIST);

if (env.BACKGROUND_JOBS) await core.startJobs();
else console.log('background jobs off (BACKGROUND_JOBS=false)');

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
  console.log(`web app expected at ${env.APP_URL}`);
});

// A port clash otherwise surfaces as a raw stack trace that buries the one useful fact.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${env.PORT} is already in use — most likely an orphaned dev server.\n  pnpm dev:stop\n`);
    process.exit(1);
  }
  throw err;
});

const shutdown = async () => {
  server.close();
  await core.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
