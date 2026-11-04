import { z } from 'zod';

/**
 * Fail fast and loudly at boot rather than on the first request that needs a missing key.
 * Claude, intervals.icu and Zwift are optional at boot: the app runs (and says so in the UI) without them.
 */
const schema = z.object({
  MONGO_DB_URI: z.string().min(1),
  MONGO_DB_NAME: z.string().min(1).default('cycling_coach'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be >=32 chars (openssl rand -base64 32)'),
  /** Public base URL of this API (Better Auth callbacks). */
  BETTER_AUTH_URL: z.url().default('http://localhost:8787'),
  APP_URL: z.url().default('http://localhost:5173'),
  /** Dev only: a second public address for the Vite dev server (ngrok, phone testing). Trusted like APP_URL. */
  DEV_PUBLIC_URL: z.url().optional(),
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CLAUDE_API_KEY: z.string().optional(),
  /** Personal API key from intervals.icu → Settings → Developer Settings (docs/DECISIONS.md #13). */
  INTERVALS_ICU_KEY: z.string().optional(),
  /** "0" = the athlete who owns the key. */
  INTERVALS_ICU_ATHLETE_ID: z.string().default('0'),
  /** Zwift login for zFTP/zMAP/weight (unofficial API, docs/DECISIONS.md #23). Both or neither. */
  ZWIFT_USERNAME: z.string().optional(),
  ZWIFT_PASSWORD: z.string().optional(),
  /**
   * The account the INTERVALS_ICU_KEY and ZWIFT_* credentials belong to. Unset: the oldest account.
   * No other account ever uses them (docs/DECISIONS.md #53).
   */
  OWNER_EMAIL: z.email().optional(),
  /** Food: the small model that reads labels and logging phrases. */
  /** api.data.gov key for USDA FoodData Central (staples fallback). Without one: the shared DEMO_KEY. */
  USDA_FDC_API_KEY: z.string().optional(),
  /** S3-compatible bucket for food label photos (same shape as ez-scheduler-checkout). All four or none. */
  S3_HOSTNAME: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKETNAME: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  /**
   * Run the job loop in this process (DECISIONS #56). Off in local dev, so it never syncs on its own;
   * leases keep any number of processes from running the same job.
   */
  BACKGROUND_JOBS: z.stringbool().default(true),
  /** Jobs one process runs at once. */
  JOBS_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Directory of the built SPA to serve in production (one container serves both). */
  WEB_DIST: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

/** Browser origins allowed to call the API with credentials (Better Auth's origin check and CORS). */
export function webOrigins(env: Env): string[] {
  const origins = [env.APP_URL, 'capacitor://localhost', 'http://localhost'];
  if (env.DEV_PUBLIC_URL) origins.push(new URL(env.DEV_PUBLIC_URL).origin);
  return origins;
}

/**
 * Pass `process.env` from the bootstrap. Kept as a parameter so this module needs no Node types.
 * An empty value (`OWNER_EMAIL=` as `.env.example` ships it) means unset.
 */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(set);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
