import {
  DEFAULT_FOOD_SLOTS,
  type Food,
  type FoodImageRef,
  type FoodInput,
  type FoodLogEntry,
  type FoodPatch,
  type FoodSettings,
  type IsoDate,
  type MealInput,
  type MealPatch,
  type RecipeInput,
  type RecipePatch,
} from '@cycling-coach/shared';
import type { Collections, FoodDoc, FoodLogDoc, MealDoc, RecipeDoc } from '../collections';
import { compact, idOf, oid } from './util';

/**
 * The user's foods database (DECISIONS #33). Foods, recipes and meals are archived, never deleted;
 * log entries carry their own nutrient snapshot.
 */

const unsetOf = (keys: readonly string[] = []) =>
  keys.length ? { $unset: Object.fromEntries(keys.map((k) => [k, ''] as const)) as Record<string, ''> } : {};

// ── Foods ───────────────────────────────────────────────────────────────────

export const toFood = (doc: FoodDoc): Food => {
  const { _id, userId: _u, archivedAt, createdAt, updatedAt, images, ...rest } = doc;
  return compact({
    ...rest,
    id: idOf(doc),
    images: images.map((i) => ({ key: i.key, kind: i.kind, createdAt: i.createdAt.toISOString() })),
    archived: archivedAt ? true : undefined,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  });
};

/** Every food, archived ones included (recipes and meals may still use them). */
export async function listFoods(c: Collections, userId: string): Promise<Food[]> {
  const docs = await c.foods.find({ userId }).sort({ name: 1 }).toArray();
  return docs.map(toFood);
}

export async function getFood(c: Collections, userId: string, id: string): Promise<Food | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.foods.findOne({ _id, userId });
  return doc ? toFood(doc) : null;
}

export async function getFoodsByIds(c: Collections, userId: string, ids: readonly string[]): Promise<Food[]> {
  const oids = ids.map(oid).filter((x) => x != null);
  if (!oids.length) return [];
  return (await c.foods.find({ userId, _id: { $in: oids } }).toArray()).map(toFood);
}

/** An active food with this (normalised) barcode. */
export async function findFoodByBarcode(c: Collections, userId: string, barcode: string): Promise<Food | null> {
  const doc = await c.foods.findOne({ userId, barcodes: barcode, archivedAt: { $exists: false } });
  return doc ? toFood(doc) : null;
}

const imageDocs = (refs: readonly FoodImageRef[], existing: FoodDoc['images'], now: Date): FoodDoc['images'] =>
  refs.map((r) => ({ key: r.key, kind: r.kind, createdAt: existing.find((e) => e.key === r.key)?.createdAt ?? now }));

export async function createFood(c: Collections, userId: string, input: FoodInput, now: Date): Promise<Food> {
  const doc: FoodDoc = {
    ...compact({ ...input, images: undefined }),
    aliases: input.aliases,
    barcodes: input.barcodes,
    images: imageDocs(input.images, [], now),
    userId,
    createdAt: now,
    updatedAt: now,
  };
  const res = await c.foods.insertOne(doc);
  return toFood({ ...doc, _id: res.insertedId });
}

export async function updateFood(c: Collections, userId: string, id: string, patch: FoodPatch, now: Date): Promise<Food | null> {
  const _id = oid(id);
  if (!_id) return null;
  const { unset, images, ...fields } = patch;
  let imageSet: Pick<FoodDoc, 'images'> | object = {};
  if (images) {
    const current = await c.foods.findOne({ _id, userId }, { projection: { images: 1 } });
    if (!current) return null;
    imageSet = { images: imageDocs(images, current.images, now) };
  }
  const doc = await c.foods.findOneAndUpdate(
    { _id, userId },
    { $set: { ...compact(fields), ...imageSet, updatedAt: now }, ...unsetOf(unset) },
    { returnDocument: 'after' },
  );
  return doc ? toFood(doc) : null;
}

export async function archiveFood(c: Collections, userId: string, id: string, now: Date): Promise<boolean> {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.foods.updateOne({ _id, userId }, { $set: { archivedAt: now, updatedAt: now } })).matchedCount === 1;
}

// ── Recipes ────────────────────────────────────────────────────────────────

export interface StoredRecipe extends RecipeInput {
  id: string;
  archived?: boolean | undefined;
  createdAt: string;
  updatedAt: string;
}

const toRecipe = (doc: RecipeDoc): StoredRecipe => {
  const { _id, userId: _u, archivedAt, createdAt, updatedAt, ...rest } = doc;
  return compact({ ...rest, id: idOf(doc), archived: archivedAt ? true : undefined, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() });
};

export async function listRecipes(c: Collections, userId: string): Promise<StoredRecipe[]> {
  return (await c.recipes.find({ userId }).sort({ name: 1 }).toArray()).map(toRecipe);
}

export async function getRecipe(c: Collections, userId: string, id: string): Promise<StoredRecipe | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.recipes.findOne({ _id, userId });
  return doc ? toRecipe(doc) : null;
}

export async function createRecipe(c: Collections, userId: string, input: RecipeInput, now: Date): Promise<StoredRecipe> {
  const doc: RecipeDoc = { ...compact(input), aliases: input.aliases, userId, createdAt: now, updatedAt: now };
  const res = await c.recipes.insertOne(doc);
  return toRecipe({ ...doc, _id: res.insertedId });
}

export async function updateRecipe(c: Collections, userId: string, id: string, patch: RecipePatch, now: Date): Promise<StoredRecipe | null> {
  const _id = oid(id);
  if (!_id) return null;
  const { unset, ...fields } = patch;
  const doc = await c.recipes.findOneAndUpdate(
    { _id, userId },
    { $set: { ...compact(fields), updatedAt: now }, ...unsetOf(unset) },
    { returnDocument: 'after' },
  );
  return doc ? toRecipe(doc) : null;
}

export async function archiveRecipe(c: Collections, userId: string, id: string, now: Date): Promise<boolean> {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.recipes.updateOne({ _id, userId }, { $set: { archivedAt: now, updatedAt: now } })).matchedCount === 1;
}

// ── Meals ──────────────────────────────────────────────────────────────────

export interface StoredMeal extends MealInput {
  id: string;
  archived?: boolean | undefined;
  createdAt: string;
  updatedAt: string;
}

const toMeal = (doc: MealDoc): StoredMeal => {
  const { _id, userId: _u, archivedAt, createdAt, updatedAt, ...rest } = doc;
  return compact({ ...rest, id: idOf(doc), archived: archivedAt ? true : undefined, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() });
};

export async function listMeals(c: Collections, userId: string): Promise<StoredMeal[]> {
  return (await c.meals.find({ userId }).sort({ name: 1 }).toArray()).map(toMeal);
}

export async function getMeal(c: Collections, userId: string, id: string): Promise<StoredMeal | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.meals.findOne({ _id, userId });
  return doc ? toMeal(doc) : null;
}

export async function createMeal(c: Collections, userId: string, input: MealInput, now: Date): Promise<StoredMeal> {
  const doc: MealDoc = { ...compact(input), aliases: input.aliases, userId, createdAt: now, updatedAt: now };
  const res = await c.meals.insertOne(doc);
  return toMeal({ ...doc, _id: res.insertedId });
}

export async function updateMeal(c: Collections, userId: string, id: string, patch: MealPatch, now: Date): Promise<StoredMeal | null> {
  const _id = oid(id);
  if (!_id) return null;
  const { unset, ...fields } = patch;
  const doc = await c.meals.findOneAndUpdate(
    { _id, userId },
    { $set: { ...compact(fields), updatedAt: now }, ...unsetOf(unset) },
    { returnDocument: 'after' },
  );
  return doc ? toMeal(doc) : null;
}

export async function archiveMeal(c: Collections, userId: string, id: string, now: Date): Promise<boolean> {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.meals.updateOne({ _id, userId }, { $set: { archivedAt: now, updatedAt: now } })).matchedCount === 1;
}

// ── The log ────────────────────────────────────────────────────────────────

export const toLogEntry = (doc: FoodLogDoc): FoodLogEntry => {
  const { _id, userId: _u, createdAt, updatedAt: _up, ...rest } = doc;
  return compact({ ...rest, id: idOf(doc), createdAt: createdAt.toISOString() });
};

export type NewLogEntry = Omit<FoodLogDoc, '_id' | 'userId' | 'createdAt' | 'updatedAt'>;

export async function listLog(c: Collections, userId: string, from: IsoDate, to: IsoDate): Promise<FoodLogEntry[]> {
  const docs = await c.foodLog.find({ userId, date: { $gte: from, $lte: to } }).sort({ date: 1, createdAt: 1 }).toArray();
  return docs.map(toLogEntry);
}

export async function getLogEntry(c: Collections, userId: string, id: string): Promise<FoodLogEntry | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.foodLog.findOne({ _id, userId });
  return doc ? toLogEntry(doc) : null;
}

/** Entries share `now`, plus a millisecond each so they keep their order within a slot. */
export async function insertLogEntries(c: Collections, userId: string, entries: readonly NewLogEntry[], now: Date): Promise<FoodLogEntry[]> {
  if (!entries.length) return [];
  const docs: FoodLogDoc[] = entries.map((e, i) => {
    const at = new Date(now.getTime() + i);
    return { ...compact(e), nutrients: e.nutrients, userId, createdAt: at, updatedAt: at } as FoodLogDoc;
  });
  const res = await c.foodLog.insertMany(docs);
  return docs.map((d, i) => toLogEntry({ ...d, _id: res.insertedIds[i]! }));
}

export async function updateLogEntry(
  c: Collections,
  userId: string,
  id: string,
  set: Partial<NewLogEntry>,
  unset: readonly string[],
  now: Date,
): Promise<FoodLogEntry | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.foodLog.findOneAndUpdate(
    { _id, userId },
    { $set: { ...compact(set), updatedAt: now }, ...unsetOf(unset) },
    { returnDocument: 'after' },
  );
  return doc ? toLogEntry(doc) : null;
}

export async function deleteLogEntry(c: Collections, userId: string, id: string): Promise<boolean> {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.foodLog.deleteOne({ _id, userId })).deletedCount === 1;
}

/** The fields `core.foodUsage` needs, for entries on or after `since`. */
export async function logUsageSince(c: Collections, userId: string, since: IsoDate) {
  const docs = await c.foodLog
    .find({ userId, date: { $gte: since }, kind: { $in: ['food', 'recipe'] } }, { projection: { kind: 1, refId: 1, slot: 1, quantity: 1, unit: 1, date: 1, createdAt: 1, fromMealId: 1 } })
    .toArray();
  return docs.flatMap((d) =>
    d.kind !== 'calories' && d.refId
      ? [compact({ kind: d.kind, refId: d.refId, slot: d.slot, quantity: d.quantity, unit: d.unit, date: d.date, createdAt: d.createdAt.toISOString(), fromMealId: d.fromMealId })]
      : [],
  );
}

/** Whether any entry still shows this photo: a meal logged as items shares its photos. */
export async function logPhotoInUse(c: Collections, userId: string, key: string): Promise<boolean> {
  return (await c.foodLog.countDocuments({ userId, 'estimate.images.key': key }, { limit: 1 })) > 0;
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function getFoodSettings(c: Collections, userId: string): Promise<FoodSettings> {
  const doc = await c.foodSettings.findOne({ userId });
  return { slots: doc?.slots?.length ? doc.slots : DEFAULT_FOOD_SLOTS };
}

export async function saveFoodSettings(c: Collections, userId: string, settings: FoodSettings, now: Date): Promise<FoodSettings> {
  await c.foodSettings.updateOne({ userId }, { $set: { slots: settings.slots, updatedAt: now }, $setOnInsert: { userId } }, { upsert: true });
  return settings;
}

export async function foodIntroSeen(c: Collections, userId: string): Promise<boolean> {
  return !!(await c.foodSettings.findOne({ userId }, { projection: { introSeenAt: 1 } }))?.introSeenAt;
}

/** Keeps the first time: a replay from the Library doesn't move it. */
export async function markFoodIntroSeen(c: Collections, userId: string, now: Date): Promise<void> {
  await c.foodSettings.updateOne({ userId }, [{ $set: { introSeenAt: { $ifNull: ['$introSeenAt', now] }, slots: { $ifNull: ['$slots', DEFAULT_FOOD_SLOTS] }, updatedAt: now } }], { upsert: true });
}
