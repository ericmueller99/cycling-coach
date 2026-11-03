/**
 * Import the Canadian Nutrient File 2026 into `cnf_foods` — the staples search table
 * (DECISIONS #33). Reference data shared by every user; each user's own foods are untouched and
 * stay empty until they save something. Idempotent: re-running refreshes the table.
 *
 *   pnpm food:import-cnf
 */
import { collections, createMongo, ensureIndexes, replaceCnfFoods } from '@cycling-coach/db';
import { loadEnv } from '../lib/env';
import { importCnf } from '../services/import-cnf';

const env = loadEnv(process.env);
const mongo = createMongo(env.MONGO_DB_URI, env.MONGO_DB_NAME);
await mongo.client.connect();
try {
  await ensureIndexes(mongo.db);
  console.log(`target: ${new URL(env.MONGO_DB_URI.replace(/^mongodb(\+srv)?:/, 'http:')).hostname} / ${env.MONGO_DB_NAME}`);
  const r = await importCnf((foods, now) => replaceCnfFoods(collections(mongo.db), foods, now));
  console.log(`Canadian Nutrient File: ${r.foods} foods (${r.upserted} written, ${r.removed} removed)`);
} finally {
  await mongo.client.close();
}
