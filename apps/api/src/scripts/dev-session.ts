/**
 * Signs the Playwright browser in without a password (DECISIONS #27). Mints a session for the seeded user with
 * Better Auth's `testUtils` and writes its cookie to `.playwright-mcp/session.json`, plus
 * `.playwright-mcp/sign-in.js` for the Playwright MCP's run-code tool (`filename`), which adds
 * the cookie and opens the app. Works against whatever `.env` points at, a remote database included:
 * it needs BETTER_AUTH_SECRET and the DB login, which are already enough to forge a session.
 *
 *   pnpm dev:session                 sign in as SEED_USER_EMAIL (or --email <email>)
 *   pnpm dev:session --revoke        delete the dev sessions
 *   pnpm dev:session --qa            create/refresh a throwaway QA user for password-flow tests
 *   pnpm dev:session --qa --remove   delete the QA user, its login and sessions
 *
 * Dev sessions are tagged and last 7 days; each run replaces the previous one. The user's own sessions
 * are never touched.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createMongo } from '@cycling-coach/db';
import { betterAuth } from 'better-auth';
import { bearer, testUtils } from 'better-auth/plugins';
import type { ObjectId } from 'mongodb';
import { authOptions, createAuth } from '../auth';
import { loadEnv } from '../lib/env';

const DEV_AGENT = 'dev-session (Playwright)';
const QA_EMAIL = 'qa@cycling-coach.test';
const TTL_SEC = 7 * 24 * 60 * 60;
const DIR = resolve(import.meta.dirname, '../../../../.playwright-mcp');

const env = loadEnv(process.env);
if (env.NODE_ENV === 'production') {
  console.error('dev-session refuses to run with NODE_ENV=production.');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const emailArg = args[args.indexOf('--email') + 1];
const email = flag('qa') ? QA_EMAIL : args.includes('--email') && emailArg ? emailArg : process.env['SEED_USER_EMAIL'];
if (!email) {
  console.error('Set SEED_USER_EMAIL in .env or pass --email <email>.');
  process.exit(1);
}

const mongo = createMongo(env.MONGO_DB_URI, env.MONGO_DB_NAME);
await mongo.client.connect();
const db = mongo.db;
console.log(`target: ${new URL(env.MONGO_DB_URI.replace(/^mongodb(\+srv)?:/, 'http:')).hostname} / ${env.MONGO_DB_NAME}`);

/** Better Auth's Mongo adapter stores `userId` as an ObjectId; match the hex form too, to be safe. */
const byUser = (id: ObjectId) => ({ userId: { $in: [id, id.toHexString()] } });

try {
  if (flag('qa') && flag('remove')) {
    const qa = await db.collection('user').findOne({ email: QA_EMAIL });
    if (!qa) {
      console.log('no QA user');
    } else {
      const sessions = await db.collection('session').deleteMany(byUser(qa._id));
      const accounts = await db.collection('account').deleteMany(byUser(qa._id));
      await db.collection('user').deleteOne({ _id: qa._id });
      console.log(`removed ${QA_EMAIL} (${accounts.deletedCount} login, ${sessions.deletedCount} sessions)`);
    }
  } else if (flag('qa')) {
    // A fresh password each time, so a test that changed it can simply run --qa again.
    const password = `qa-${randomBytes(9).toString('base64url')}`;
    const existing = await db.collection('user').findOne({ email: QA_EMAIL });
    if (existing) {
      await db.collection('session').deleteMany(byUser(existing._id));
      await db.collection('account').deleteMany(byUser(existing._id));
      await db.collection('user').deleteOne({ _id: existing._id });
    }
    // No profile: both sync loops only visit users with one (server.ts), so the QA user is inert.
    await createAuth(mongo, env, { allowSignUp: true }).api.signUpEmail({ body: { email: QA_EMAIL, password, name: 'QA Tester' } });
    console.log(`QA user ready — sign in through the login form:\n  email:    ${QA_EMAIL}\n  password: ${password}`);
  } else {
    const user = await db.collection('user').findOne({ email });
    if (!user) throw new Error(`no user ${email}`);
    const removed = await db.collection('session').deleteMany({ ...byUser(user._id), userAgent: DEV_AGENT });
    if (flag('revoke')) {
      console.log(`revoked ${removed.deletedCount} dev session(s) for ${email}`);
    } else {
      const auth = betterAuth({ ...authOptions(mongo, env), plugins: [bearer(), testUtils()] });
      const { session, cookies } = await (await auth.$context).test.login({ userId: user._id.toHexString() });
      const expires = Math.floor(Date.now() / 1000) + TTL_SEC;
      await db.collection('session').updateOne({ token: session.token }, { $set: { userAgent: DEV_AGENT, expiresAt: new Date(expires * 1000) } });
      const out = cookies.map((c) => ({ ...c, domain: 'localhost', expires }));
      await mkdir(DIR, { recursive: true });
      await writeFile(resolve(DIR, 'session.json'), `${JSON.stringify(out, null, 2)}\n`);
      await writeFile(
        resolve(DIR, 'sign-in.js'),
        `async (page) => {\n  await page.context().addCookies(${JSON.stringify(out)});\n  await page.goto('${env.APP_URL}');\n}\n`,
      );
      console.log(`signed in as ${email} (${String(user['name'])}) until ${new Date(expires * 1000).toISOString()}`);
      console.log(`Playwright: run code with filename ${resolve(DIR, 'sign-in.js')}`);
    }
  }
} finally {
  await mongo.client.close();
}
