import { createCore } from './compose';
import { loadEnv } from './lib/env';

/**
 * Jobs only, no HTTP (DECISIONS #56–57): the same composition as the server, running the job loop.
 * Run it beside servers started with BACKGROUND_JOBS=false — or beside ones that also run the loop;
 * leases keep every job to one process either way.
 *
 *   node dist/worker.js          (production image)
 *   pnpm --filter @cycling-coach/api worker   (dev)
 */
const core = await createCore({ env: loadEnv(process.env) });
await core.startJobs();
console.log('worker running jobs');

const shutdown = async () => {
  await core.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
