import type { Collections, CnfFoodDoc } from '../collections';

/** The Canadian Nutrient File reference table (`cnf_foods`). */

export type CnfFoodWrite = Omit<CnfFoodDoc, '_id' | 'importedAt'> & { code: string };

/** Replace the table with a fresh import: upsert every food, drop codes no longer published. */
export async function replaceCnfFoods(c: Collections, foods: readonly CnfFoodWrite[], now: Date): Promise<{ upserted: number; removed: number }> {
  const ops = foods.map(({ code, ...f }) => ({
    replaceOne: { filter: { _id: code }, replacement: { ...stripUndefined(f), _id: code, importedAt: now } as CnfFoodDoc, upsert: true },
  }));
  let upserted = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const res = await c.cnfFoods.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    upserted += res.upsertedCount + res.modifiedCount;
  }
  const removed = (await c.cnfFoods.deleteMany({ _id: { $nin: foods.map((f) => f.code) } })).deletedCount;
  return { upserted, removed };
}

export async function countCnfFoods(c: Collections): Promise<number> {
  return c.cnfFoods.estimatedDocumentCount();
}

/** What staple search ranks over: names, alternate names, portion labels and kcal. */
export async function cnfSearchIndex(c: Collections) {
  const docs = await c.cnfFoods
    .find({}, { projection: { name: 1, alt: 1, group: 1, 'per100g.kcal': 1, 'portions.label': 1 } })
    .toArray();
  return docs.map((d) => ({ code: d._id, name: d.name, alt: d.alt, group: d.group, kcal: d.per100g.kcal, portionLabels: d.portions.map((p) => p.label) }));
}

export async function getCnfFood(c: Collections, code: string): Promise<CnfFoodDoc | null> {
  return c.cnfFoods.findOne({ _id: code });
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
