import type { CnfFoodWrite } from '@cycling-coach/db';
import { buildCnfFoods, downloadCnf } from '../providers/cnf';

/** Download, join and store the Canadian Nutrient File. Shared by the import script and seed. */
export async function importCnf(
  write: (foods: CnfFoodWrite[], now: Date) => Promise<{ upserted: number; removed: number }>,
  fetchImpl: typeof fetch = fetch,
) {
  const foods = buildCnfFoods(await downloadCnf(fetchImpl));
  if (foods.length < 1000) throw new Error(`CNF import looks wrong: only ${foods.length} foods parsed`);
  const result = await write(
    foods.map((f) => ({ code: f.code, name: f.name, nameFr: f.nameFr, alt: f.alt, group: f.group, per100g: f.per100g, portions: f.portions }) as CnfFoodWrite),
    new Date(),
  );
  return { foods: foods.length, ...result };
}
