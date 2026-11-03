/**
 * One-time setup: creates your account (the only time sign-up is enabled), a starting profile, the
 * starter workout library and the staples food table. Idempotent — re-running fills gaps and never
 * overwrites anything already there.
 *
 *   pnpm db:seed [-- --ftp 250 --weight 72 --timezone Europe/London] [--sample]
 *   docker compose run --rm app node dist/seed.js [--ftp …] [--sample]
 *
 * The profile is a starting point: FTP, weight and timezone are editable in the app, and the first
 * intervals.icu sync replaces the weight with the synced trend. `--sample` adds example goals and
 * coach memory to show what they look like; delete them on the Athlete page.
 */
import { collections, countCnfFoods, createGoal, createMemory, createMongo, ensureIndexes, replaceCnfFoods, saveProfile } from '@cycling-coach/db';
import { profileSchema, type GoalInput } from '@cycling-coach/shared';
import { createAuth } from '../auth';
import { loadEnv } from '../lib/env';
import { importCnf } from '../services/import-cnf';
import { seedStarterLibrary } from '../services/onboarding';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const env = loadEnv(process.env);
const email = process.env['SEED_USER_EMAIL'];
const password = process.env['SEED_USER_PASSWORD'];
const name = process.env['SEED_USER_NAME'];
if (!email || !password || !name) {
  console.error('Set SEED_USER_EMAIL, SEED_USER_PASSWORD and SEED_USER_NAME in .env first.');
  process.exit(1);
}

/** The machine's zone, unless it's a bare container (UTC); the app's Account page changes it. */
const timezone = option('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
const profile = profileSchema.safeParse({
  ftpZwift: Number(option('ftp') ?? 200),
  weightKg: Number(option('weight') ?? 75),
  weightSource: 'manual',
  timezone,
});
if (!profile.success) {
  console.error(`Invalid profile option: ${profile.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  process.exit(1);
}
try {
  new Intl.DateTimeFormat('en', { timeZone: timezone });
} catch {
  console.error(`Unknown timezone "${timezone}" — use an IANA name like Europe/London.`);
  process.exit(1);
}

const mongo = createMongo(env.MONGO_DB_URI, env.MONGO_DB_NAME);
await mongo.client.connect();
await ensureIndexes(mongo.db);
const c = collections(mongo.db);
const now = new Date();

const auth = createAuth(mongo, env, { allowSignUp: true });
let user = await mongo.db.collection('user').findOne({ email });
if (!user) {
  await auth.api.signUpEmail({ body: { email, password, name } });
  user = await mongo.db.collection('user').findOne({ email });
  console.log(`created account ${email}`);
} else {
  console.log(`account ${email} already exists`);
}
if (!user) throw new Error('account creation failed');
const userId = user._id.toHexString();

if (!(await c.profiles.findOne({ userId }))) {
  await saveProfile(c, userId, profile.data, now);
  console.log(`created profile: FTP ${profile.data.ftpZwift} W, ${profile.data.weightKg} kg, ${profile.data.timezone} — edit it on the Athlete page`);
}

if (args.includes('--sample') && (await c.goals.countDocuments({ userId })) === 0) {
  const goals: GoalInput[] = [
    {
      horizon: 'long',
      title: 'Reach 4 W/kg',
      detail: 'FTP over trend weight',
      targetLabel: 'This season',
      // Measured live from the profile (DECISIONS #19). No current value is stored.
      measure: { kind: 'wkg', weight: 'trend' },
      target: 4,
      done: false,
      primary: true,
    },
    { horizon: 'long', title: 'Stronger 3–5 min climbs', detail: 'Sample goal — edit or delete it', targetLabel: 'Ongoing', done: false, primary: false },
    { horizon: 'short', title: 'One long Z2 ride every week', done: false, primary: false },
  ];
  for (const g of goals) await createGoal(c, userId, g, now);
  console.log('added sample goals');
}

if (args.includes('--sample') && (await c.memories.countDocuments({ userId })) === 0) {
  for (const text of ['Trains about 6 hours a week: two weekday sessions plus a long weekend ride', 'Prefers direct, data-grounded coaching']) {
    await createMemory(c, userId, text, 'user', now);
  }
  console.log('added sample coach memory');
}

const added = await seedStarterLibrary(c, userId, now);
if (added) console.log(`added ${added} starter workouts`);

// Staples search table (reference data, not your foods — those start empty by design).
if ((await countCnfFoods(c)) === 0) {
  const r = await importCnf((foods, at) => replaceCnfFoods(c, foods, at));
  console.log(`imported the Canadian Nutrient File (${r.foods} foods)`);
}

await mongo.client.close();
console.log('done');
