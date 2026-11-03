import { MIN_PASSWORD_LENGTH } from '@cycling-coach/shared';
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { bearer } from 'better-auth/plugins';
import type { Db, MongoClient } from 'mongodb';
import { type Env, webOrigins } from './lib/env';

/**
 * Auth lives in our own database (users, sessions) — same pattern as ai-budget, on Mongo.
 *
 * The `bearer` plugin is not optional: the future Capacitor app can't rely on cookies, so native
 * authenticates with a token while the web uses a cookie session. Both hit the same handler.
 *
 * Sign-up is closed on self-host: the account is created by `pnpm db:seed`. `allowSignUp` exists for
 * that seed run, the dev-session script's QA user, and the hosted version (DECISIONS #57), which also
 * adds its own plugins and options (email verification, password reset, user fields) through
 * `AuthExtension`.
 *
 * The options are exported so `scripts/dev-session.ts` can build a test instance whose cookies
 * are named and signed exactly like the real one's.
 */
/**
 * Takes the driver's own types rather than `@cycling-coach/db`'s: this module is reachable from
 * `AppType`, which the SPA typechecks, and the db package's source needs Node types.
 */
export function authOptions(mongo: { db: Db; client: MongoClient }, env: Env, opts: { allowSignUp?: boolean } = {}) {
  return {
    database: mongodbAdapter(mongo.db, { client: mongo.client }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: webOrigins(env),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !opts.allowSignUp,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    session: {
      // A personal app on personal devices: stay signed in for a long time.
      expiresIn: 60 * 60 * 24 * 90,
      updateAge: 60 * 60 * 24,
    },
  };
}

/** What a caller can add on top of the base setup (DECISIONS #57). */
export interface AuthExtension {
  allowSignUp?: boolean;
  /** Appended after `bearer()`. */
  plugins?: BetterAuthPlugin[];
  /** Merged over the base options; `emailAndPassword` is merged field by field. */
  options?: Partial<BetterAuthOptions>;
}

function baseAuth(mongo: { db: Db; client: MongoClient }, env: Env, opts: { allowSignUp?: boolean }) {
  return betterAuth({ ...authOptions(mongo, env, opts), plugins: [bearer()] });
}

/**
 * The app's view of auth: the base instance's type, whatever plugins were added — the routes only use
 * `handler` and `api.getSession`. A caller that needs a plugin's own server API keeps its own typing.
 */
export type Auth = ReturnType<typeof baseAuth>;

export function createAuth(mongo: { db: Db; client: MongoClient }, env: Env, opts: AuthExtension = {}): Auth {
  if (!opts.plugins?.length && !opts.options) return baseAuth(mongo, env, opts);
  const base = authOptions(mongo, env, opts);
  return betterAuth({
    ...base,
    ...opts.options,
    emailAndPassword: { ...base.emailAndPassword, ...opts.options?.emailAndPassword },
    plugins: [bearer(), ...(opts.plugins ?? [])],
  }) as unknown as Auth;
}
