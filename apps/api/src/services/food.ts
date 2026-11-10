import { randomUUID } from 'node:crypto';
import {
  addDays,
  amountPerServing,
  canonicalUnit,
  computePortion,
  duplicateMeasureUnits,
  entryRef,
  estimateAsFood,
  estimateItemTotals,
  estimateTotals,
  foodAsLoggable,
  foodUsage,
  mealTotal,
  normalizeBarcode,
  recipeAsLoggable,
  recipeTotals,
  scaleNutrients,
  scaleRange,
  todayIn,
  type Loggable,
} from '@cycling-coach/core';
import {
  archiveFood,
  archiveMeal,
  archiveRecipe,
  createFood,
  createMeal,
  createRecipe,
  deleteLogEntry,
  getFood,
  foodIntroSeen,
  getFoodSettings,
  getFoodsByIds,
  getLogEntry,
  getMeal,
  getProfile,
  getRecipe,
  insertLogEntries,
  listFoods,
  listLog,
  listMeals,
  listRecipes,
  logPhotoInUse,
  logUsageSince,
  markFoodIntroSeen,
  saveFoodSettings,
  updateFood,
  updateLogEntry,
  updateMeal,
  updateRecipe,
  compact,
  type Collections,
  type NewLogEntry,
  type StoredMeal,
  type StoredRecipe,
} from '@cycling-coach/db';
import type {
  CaloriesEdit,
  CaloriesLogInput,
  EntryEstimate,
  EntryPhoto,
  EstimateLogInput,
  EstimatePhotoRef,
  Nutrients,
  Food,
  FoodInput,
  FoodLibrary,
  FoodLogEntry,
  FoodLogInput,
  FoodLogPatch,
  FoodPatch,
  FoodSettings,
  IsoDate,
  LoggableKind,
  Meal,
  MealInput,
  MealPatch,
  Recipe,
  RecipeInput,
  RecipePatch,
} from '@cycling-coach/shared';
import type { ServiceFailure as Failure } from '../app';
import { userImagePrefix, type PhotoStore } from '../providers/storage/s3';

/** How far back "usual portion" and search ranking look. */
const USAGE_DAYS = 180;

const bad = (error: string): Failure => ({ error, status: 400 });
const notFound = (what: string): Failure => ({ error: `${what} not found.`, status: 404 });

/**
 * The user's foods database and log (DECISIONS #33). No AI here: logging is from the database, or
 * numbers the user has confirmed (#94), and the portion maths is `core`'s.
 */
export class FoodService {
  constructor(
    private readonly c: Collections,
    private readonly now: () => Date = () => new Date(),
    /** Null when S3 isn't set up: an estimate is logged without its photos. */
    private readonly photos: Pick<PhotoStore, 'put' | 'remove' | 'signedUrl'> | null = null,
  ) {}

  private async today(userId: string): Promise<IsoDate> {
    const profile = await getProfile(this.c, userId);
    return todayIn(profile?.timezone ?? 'UTC', this.now());
  }

  // ── Library ───────────────────────────────────────────────────────────

  /** Everything the client searches and logs from, in one payload. */
  async library(userId: string): Promise<FoodLibrary> {
    const today = await this.today(userId);
    const [foods, stored, meals, usageRows, settings, introSeen] = await Promise.all([
      listFoods(this.c, userId),
      listRecipes(this.c, userId),
      listMeals(this.c, userId),
      logUsageSince(this.c, userId, addDays(today, -USAGE_DAYS)),
      getFoodSettings(this.c, userId),
      foodIntroSeen(this.c, userId),
    ]);
    const foodsById = new Map(foods.map((f) => [f.id, f]));
    const recipes = stored.map((r) => withTotals(r, foodsById));
    const recipesById = new Map(recipes.map((r) => [r.id, r]));
    const lookup = loggableLookup(foodsById, recipesById);
    return {
      foods,
      recipes,
      meals: meals.map((m) => withMealTotal(m, lookup)),
      usage: foodUsage(usageRows),
      settings,
      introSeen,
    };
  }

  // ── Foods ─────────────────────────────────────────────────────────────

  async createFood(userId: string, input: FoodInput): Promise<Food | Failure> {
    if (input.images.some((i) => !i.key.startsWith(userImagePrefix(userId)))) return bad('Unknown photo.');
    const checked = await this.checkFood(userId, input);
    if ('error' in checked) return checked;
    return createFood(this.c, userId, { ...input, ...checked }, this.now());
  }

  async updateFood(userId: string, id: string, patch: FoodPatch): Promise<Food | Failure> {
    const current = await getFood(this.c, userId, id);
    if (!current) return notFound('Food');
    if (patch.images?.some((i) => !i.key.startsWith(userImagePrefix(userId)))) return bad('Unknown photo.');
    const merged = {
      measures: patch.measures ?? current.measures,
      defaultPortion: patch.defaultPortion ?? current.defaultPortion,
      barcodes: patch.barcodes ?? current.barcodes,
    };
    const checked = await this.checkFood(userId, merged, id);
    if ('error' in checked) return checked;
    // A saved estimate's range follows its kcal, so editing the food can't leave it behind.
    const rescaled =
      current.estimate && patch.nutrients && !patch.estimate && !patch.unset?.includes('estimate') && current.nutrients.kcal > 0
        ? { estimate: scaleRange(current.estimate, patch.nutrients.kcal / current.nutrients.kcal) }
        : {};
    const fixed: FoodPatch = {
      ...patch,
      ...rescaled,
      ...(patch.measures ? { measures: checked.measures } : {}),
      ...(patch.defaultPortion ? { defaultPortion: checked.defaultPortion } : {}),
      ...(patch.barcodes ? { barcodes: checked.barcodes } : {}),
    };
    return (await updateFood(this.c, userId, id, fixed, this.now())) ?? notFound('Food');
  }

  archiveFood(userId: string, id: string) {
    return archiveFood(this.c, userId, id, this.now());
  }

  /**
   * Canonical units, measures that resolve, a default portion the food can be measured in, and
   * barcodes that are valid and not already on another food.
   */
  private async checkFood(
    userId: string,
    f: Pick<FoodInput, 'measures' | 'defaultPortion' | 'barcodes'>,
    selfId?: string,
  ): Promise<Pick<FoodInput, 'measures' | 'defaultPortion' | 'barcodes'> | Failure> {
    const measures = f.measures.map((m) => ({ unit: canonicalUnit(m.unit), amount: m.amount }));
    const dups = duplicateMeasureUnits(measures);
    if (dups.length) return bad(`Two serving sizes use the same unit (${dups.join(', ')}).`);
    const defaultPortion = { quantity: f.defaultPortion.quantity, unit: canonicalUnit(f.defaultPortion.unit) };
    if (amountPerServing({ measures }, defaultPortion.unit) == null) {
      return bad(`The default portion's unit (${defaultPortion.unit}) isn't one of the food's serving sizes.`);
    }
    const barcodes: string[] = [];
    for (const raw of f.barcodes) {
      const code = normalizeBarcode(raw);
      if (!code) return bad(`"${raw}" isn't a valid barcode.`);
      if (!barcodes.includes(code)) barcodes.push(code);
    }
    for (const code of barcodes) {
      const other = await this.c.foods.findOne({ userId, barcodes: code, archivedAt: { $exists: false } }, { projection: { name: 1 } });
      if (other && other._id.toHexString() !== selfId) {
        return { error: `Barcode ${code} is already on "${other.name}".`, status: 409 };
      }
    }
    return { measures, defaultPortion, barcodes };
  }

  // ── Recipes & meals ───────────────────────────────────────────────────

  private async recipeView(userId: string, r: StoredRecipe): Promise<Recipe> {
    const foods = await getFoodsByIds(this.c, userId, r.ingredients.map((i) => i.foodId));
    return withTotals(r, new Map(foods.map((f) => [f.id, f])));
  }

  async createRecipe(userId: string, input: RecipeInput): Promise<Recipe> {
    return this.recipeView(userId, await createRecipe(this.c, userId, normalizeRecipe(input), this.now()));
  }

  async updateRecipe(userId: string, id: string, patch: RecipePatch): Promise<Recipe | null> {
    const r = await updateRecipe(this.c, userId, id, patch.ingredients ? { ...patch, ingredients: normalizeRecipe({ ingredients: patch.ingredients }).ingredients } : patch, this.now());
    return r ? this.recipeView(userId, r) : null;
  }

  archiveRecipe(userId: string, id: string) {
    return archiveRecipe(this.c, userId, id, this.now());
  }

  private async mealView(userId: string, m: StoredMeal): Promise<Meal> {
    const lookup = await this.lookupFor(userId, m.items);
    return withMealTotal(m, lookup);
  }

  async createMeal(userId: string, input: MealInput): Promise<Meal> {
    return this.mealView(userId, await createMeal(this.c, userId, normalizeMeal(input), this.now()));
  }

  async updateMeal(userId: string, id: string, patch: MealPatch): Promise<Meal | null> {
    const m = await updateMeal(this.c, userId, id, patch.items ? { ...patch, items: normalizeMeal({ items: patch.items }).items } : patch, this.now());
    return m ? this.mealView(userId, m) : null;
  }

  archiveMeal(userId: string, id: string) {
    return archiveMeal(this.c, userId, id, this.now());
  }

  /** Loggables for a set of refs, with recipes computed from their current ingredient foods. */
  private async lookupFor(userId: string, refs: readonly { kind: LoggableKind; refId: string }[]) {
    const recipeIds = [...new Set(refs.filter((r) => r.kind === 'recipe').map((r) => r.refId))];
    const recipes = (await Promise.all(recipeIds.map((id) => getRecipe(this.c, userId, id)))).filter((r) => r != null);
    const foodIds = [
      ...refs.filter((r) => r.kind === 'food').map((r) => r.refId),
      ...recipes.flatMap((r) => r.ingredients.map((i) => i.foodId)),
    ];
    const foods = await getFoodsByIds(this.c, userId, [...new Set(foodIds)]);
    const foodsById = new Map(foods.map((f) => [f.id, f]));
    const recipesById = new Map(recipes.map((r) => [r.id, withTotals(r, foodsById)]));
    return loggableLookup(foodsById, recipesById);
  }

  // ── The log ───────────────────────────────────────────────────────────

  listLog(userId: string, from: IsoDate, to: IsoDate) {
    return listLog(this.c, userId, from, to);
  }

  /** Log one or more portions (a single food, a meal's items, a confirmed words draft). */
  async log(userId: string, inputs: readonly FoodLogInput[]): Promise<FoodLogEntry[] | Failure> {
    const mealIds = [...new Set(inputs.map((i) => i.fromMealId).filter((x) => x != null))];
    const meals = await Promise.all(mealIds.map((id) => getMeal(this.c, userId, id)));
    if (meals.some((m) => !m)) return notFound('Meal');
    const lookup = await this.lookupFor(userId, inputs);
    const docs: NewLogEntry[] = [];
    for (const input of inputs) {
      const item = lookup(input.kind, input.refId);
      if (!item) return notFound(input.kind === 'food' ? 'Food' : 'Recipe');
      const entry = snapshot(item, input);
      if (!entry) return bad(`${item.name} can't be measured in "${input.unit}".`);
      docs.push(entry);
    }
    return insertLogEntries(this.c, userId, docs, this.now());
  }

  /** Numbers the user knows, with no food behind them. Blank macros count as 0 in the day's totals. */
  async logCalories(userId: string, input: CaloriesLogInput): Promise<FoodLogEntry> {
    const entry = caloriesEntry(input, input.name || 'Calories', fullNutrients(input.nutrients), 'manual', 'manual');
    const [logged] = await insertLogEntries(this.c, userId, [entry], this.now());
    return logged!;
  }

  /**
   * The rider pressed Log on an estimate: the first time anything is written, photos included, so an
   * abandoned estimate leaves nothing behind. Totals are worked out here from the items.
   */
  async logEstimate(userId: string, input: EstimateLogInput): Promise<FoodLogEntry[]> {
    const images = await this.keepPhotos(userId, input.images);
    const shared = {
      kind: input.kind,
      ...(input.kind === 'restaurant' && input.place ? { place: input.place } : {}),
      images,
      ...(input.saveAs ? { savedAs: input.saveAs } : {}),
    };
    const total = estimateTotals(input.items);
    const group = randomUUID();
    const docs: NewLogEntry[] =
      input.logAs === 'meal'
        ? [caloriesEntry(input, input.name, total.nutrients, 'estimate', 'estimate', { low: total.low, high: total.high, items: input.items, ...shared })]
        : input.items.map((item) => {
            const t = estimateItemTotals(item);
            return caloriesEntry(input, item.name, t.nutrients, 'estimate', 'estimate', { low: t.low, high: t.high, group, items: [item], ...shared });
          });
    let entries: FoodLogEntry[];
    try {
      entries = await insertLogEntries(this.c, userId, docs, this.now());
    } catch (err) {
      await this.dropPhotos(images.map((i) => i.key));
      throw err;
    }
    if (input.saveAs) await this.saveEstimate(userId, input);
    return entries;
  }

  /** Keeping the photos is a nice-to-have, so one that won't upload is left out, not an error. */
  private async keepPhotos(userId: string, photos: EstimateLogInput['images']): Promise<EstimatePhotoRef[]> {
    const store = this.photos;
    if (!store) return [];
    const kept = await Promise.allSettled(
      photos.map(async (p): Promise<EstimatePhotoRef> => {
        const key = `${userImagePrefix(userId)}${randomUUID()}.${p.mediaType === 'image/png' ? 'png' : p.mediaType === 'image/webp' ? 'webp' : 'jpg'}`;
        await store.put(key, Buffer.from(p.data, 'base64'), p.mediaType);
        return { key, kind: p.kind };
      }),
    );
    return kept.flatMap((r) => {
      if (r.status === 'fulfilled') return [r.value];
      console.warn('estimate photo upload failed', r.reason instanceof Error ? r.reason.message : r.reason);
      return [];
    });
  }

  private async dropPhotos(keys: readonly string[]) {
    const store = this.photos;
    if (!store) return;
    await Promise.allSettled(keys.map((k) => store.remove(k)));
  }

  /**
   * Save a logged estimate to their foods, to find by search next time. The same name updates the
   * estimate that's there, and never touches a food of theirs that isn't one. The meal is already
   * logged, so a failure here doesn't undo it.
   */
  private async saveEstimate(userId: string, input: EstimateLogInput): Promise<void> {
    const food = estimateAsFood(input.saveAs!, input.items, input.place);
    const same = (await listFoods(this.c, userId)).find((f) => !f.archived && f.name.toLowerCase() === food.name.toLowerCase());
    if (!same) {
      await this.createFood(userId, food);
    } else if (same.source === 'estimate') {
      await this.updateFood(userId, same.id, { nutrients: food.nutrients, estimate: food.estimate, notes: food.notes });
    }
  }

  /** Short-lived links to an entry's photos. */
  async entryPhotos(userId: string, id: string): Promise<EntryPhoto[] | Failure> {
    const entry = await getLogEntry(this.c, userId, id);
    if (!entry) return notFound('Entry');
    const store = this.photos;
    if (!store || !entry.estimate) return [];
    return Promise.all(entry.estimate.images.map(async (i) => ({ kind: i.kind, url: await store.signedUrl(i.key) })));
  }

  /** Change a `calories` entry: its numbers, or an estimate's items, whose sums happen here. */
  async editCalories(userId: string, id: string, edit: CaloriesEdit): Promise<FoodLogEntry | Failure> {
    const entry = await getLogEntry(this.c, userId, id);
    if (!entry) return notFound('Entry');
    if (entry.kind !== 'calories') return bad('Only a calories entry can be changed this way.');
    const set: Partial<NewLogEntry> = edit.name ? { name: edit.name } : {};
    if (edit.items) {
      if (!entry.estimate) return bad('This entry has no items.');
      const { low, high, nutrients } = estimateTotals(edit.items);
      Object.assign(set, { nutrients, estimate: { ...entry.estimate, low, high, items: edit.items } });
    }
    if (edit.nutrients) {
      if (entry.estimate) return bad('Change an estimate through its items.');
      set.nutrients = fullNutrients(edit.nutrients);
    }
    return (await updateLogEntry(this.c, userId, id, set, [], this.now())) ?? notFound('Entry');
  }

  /**
   * Edit an entry's portion, slot, time or day. A new portion is priced from the food as it is
   * now; if the food is gone, the old snapshot is scaled. A `calories` entry has no portion: its
   * numbers change through `editCalories`, which keeps an estimate's header equal to its items.
   */
  async patchEntry(userId: string, id: string, patch: FoodLogPatch): Promise<FoodLogEntry | Failure> {
    const entry = await getLogEntry(this.c, userId, id);
    if (!entry) return notFound('Entry');
    const { unset = [], quantity, unit, ...rest } = patch;
    const unsetKeys: string[] = [...unset];
    const set: Partial<NewLogEntry> = compact(rest);
    if (quantity != null || unit != null) {
      const ref = entryRef(entry);
      if (!ref) return bad(`${entry.name} has no portion to change.`);
      const q = quantity ?? entry.quantity;
      const u = canonicalUnit(unit ?? entry.unit);
      const item = (await this.lookupFor(userId, [ref]))(ref.kind, ref.refId);
      const priced = item ? computePortion(item, q, u) : null;
      if (priced) Object.assign(set, { quantity: q, unit: u, servings: priced.servings, grams: priced.grams, nutrients: priced.nutrients });
      else if (u === canonicalUnit(entry.unit)) {
        const factor = q / entry.quantity;
        Object.assign(set, {
          quantity: q,
          servings: entry.servings * factor,
          grams: entry.grams != null ? entry.grams * factor : undefined,
          nutrients: scaleNutrients(entry.nutrients, factor),
        });
      } else return bad(`${entry.name} can't be measured in "${u}".`);
      if (priced && priced.grams == null) unsetKeys.push('grams');
      // From a saved estimate: its range moves with the portion.
      const servings = (set as { servings?: number }).servings;
      if (entry.estimate && servings != null && entry.servings > 0) {
        set.estimate = { ...entry.estimate, ...scaleRange(entry.estimate, servings / entry.servings) };
      }
    }
    return (await updateLogEntry(this.c, userId, id, set, unsetKeys, this.now())) ?? notFound('Entry');
  }

  /** A photo goes with the last entry showing it: a meal logged as items shares them. */
  async deleteEntry(userId: string, id: string) {
    const entry = await getLogEntry(this.c, userId, id);
    const deleted = await deleteLogEntry(this.c, userId, id);
    const keys = deleted ? (entry?.estimate?.images ?? []).map((i) => i.key) : [];
    const inUse = await Promise.all(keys.map((k) => logPhotoInUse(this.c, userId, k)));
    await this.dropPhotos(keys.filter((_, i) => !inUse[i]));
    return deleted;
  }

  /** "Copy to another day": the same portion, priced from the food as it is now. */
  async copyEntry(userId: string, id: string, to: { date: IsoDate; slot?: string | undefined }): Promise<FoodLogEntry | Failure> {
    const entry = await getLogEntry(this.c, userId, id);
    if (!entry) return notFound('Entry');
    const ref = entryRef(entry);
    if (!ref) {
      // Nothing to price it from, so it's the same numbers. The photos stay with the original.
      const at = { date: to.date, slot: to.slot ?? entry.slot, ...(entry.time ? { time: entry.time } : {}) };
      const doc = caloriesEntry(at, entry.name, entry.nutrients, entry.source, entry.via, entry.estimate && soloEstimate(entry.estimate));
      const [copy] = await insertLogEntries(this.c, userId, [doc], this.now());
      return copy!;
    }
    const result = await this.log(userId, [
      { date: to.date, slot: to.slot ?? entry.slot, ...ref, quantity: entry.quantity, unit: entry.unit, via: 'manual', ...(entry.time ? { time: entry.time } : {}) },
    ]);
    return 'error' in result ? result : result[0]!;
  }

  // ── Settings ──────────────────────────────────────────────────────────

  getSettings(userId: string) {
    return getFoodSettings(this.c, userId);
  }

  saveSettings(userId: string, settings: FoodSettings) {
    return saveFoodSettings(this.c, userId, settings, this.now());
  }

  markIntroSeen(userId: string) {
    return markFoodIntroSeen(this.c, userId, this.now());
  }
}

function withTotals(r: StoredRecipe, foodsById: ReadonlyMap<string, Food>): Recipe {
  return { ...r, totals: recipeTotals(r, foodsById) };
}

function withMealTotal(m: StoredMeal, lookup: (kind: LoggableKind, id: string) => Loggable | undefined): Meal {
  return { ...m, total: mealTotal(m.items, lookup) };
}

function loggableLookup(foodsById: ReadonlyMap<string, Food>, recipesById: ReadonlyMap<string, Recipe>) {
  return (kind: LoggableKind, id: string): Loggable | undefined => {
    if (kind === 'food') {
      const f = foodsById.get(id);
      return f ? foodAsLoggable(f) : undefined;
    }
    const r = recipesById.get(id);
    return r ? recipeAsLoggable(r) : undefined;
  };
}

/** The stored entry: portion as entered, priced now, with name and source snapshotted. */
function snapshot(item: Loggable, input: FoodLogInput): NewLogEntry | null {
  const unit = canonicalUnit(input.unit);
  const priced = computePortion(item, input.quantity, unit);
  if (!priced) return null;
  return {
    date: input.date,
    slot: input.slot,
    ...(input.time ? { time: input.time } : {}),
    kind: input.kind,
    refId: input.refId,
    name: item.name,
    ...(item.brand ? { brand: item.brand } : {}),
    source: item.source,
    quantity: input.quantity,
    unit,
    servings: priced.servings,
    ...(priced.grams != null ? { grams: priced.grams } : {}),
    nutrients: priced.nutrients,
    via: input.via,
    ...(input.fromMealId ? { fromMealId: input.fromMealId } : {}),
    ...(item.estimate ? { estimate: { ...scaleRange(item.estimate, priced.servings), items: [], images: [] } } : {}),
  };
}

/** A copy stands alone: it's in no group, and the photos stay with the original. */
function soloEstimate({ group: _group, ...estimate }: EntryEstimate): EntryEstimate {
  return { ...estimate, images: [] };
}

const fullNutrients = (n: CaloriesLogInput['nutrients']): Nutrients => ({ ...n, fat: n.fat ?? 0, carbs: n.carbs ?? 0, protein: n.protein ?? 0 });

/** An entry with no food behind it: one serving of itself. */
function caloriesEntry(
  at: Pick<CaloriesLogInput, 'date' | 'slot' | 'time'>,
  name: string,
  nutrients: Nutrients,
  source: FoodLogEntry['source'],
  via: FoodLogEntry['via'],
  estimate?: EntryEstimate,
): NewLogEntry {
  return {
    date: at.date,
    slot: at.slot,
    ...(at.time ? { time: at.time } : {}),
    kind: 'calories',
    name,
    source,
    quantity: 1,
    unit: 'serving',
    servings: 1,
    nutrients,
    via,
    ...(estimate ? { estimate } : {}),
  };
}

function normalizeRecipe<T extends Pick<RecipeInput, 'ingredients'>>(r: T): T {
  return { ...r, ingredients: r.ingredients.map((i) => ({ ...i, unit: canonicalUnit(i.unit) })) };
}

function normalizeMeal<T extends Pick<MealInput, 'items'>>(m: T): T {
  return { ...m, items: m.items.map((i) => ({ ...i, unit: canonicalUnit(i.unit) })) };
}
