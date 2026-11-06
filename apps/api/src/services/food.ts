import {
  addDays,
  amountPerServing,
  canonicalUnit,
  computePortion,
  duplicateMeasureUnits,
  foodAsLoggable,
  foodUsage,
  mealTotal,
  normalizeBarcode,
  recipeAsLoggable,
  recipeTotals,
  scaleNutrients,
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
import { userImagePrefix } from '../providers/storage/s3';

/** How far back "usual portion" and search ranking look. */
const USAGE_DAYS = 180;

const bad = (error: string): Failure => ({ error, status: 400 });
const notFound = (what: string): Failure => ({ error: `${what} not found.`, status: 404 });

/**
 * The user's foods database and log (DECISIONS #33). No AI here: logging is always from
 * the database, and the portion maths is `core`'s.
 */
export class FoodService {
  constructor(
    private readonly c: Collections,
    private readonly now: () => Date = () => new Date(),
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
    const fixed: FoodPatch = {
      ...patch,
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

  /**
   * Edit an entry's portion, slot, time or day. A new portion is priced from the food as it is
   * now; if the food is gone, the old snapshot is scaled.
   */
  async patchEntry(userId: string, id: string, patch: FoodLogPatch): Promise<FoodLogEntry | Failure> {
    const entry = await getLogEntry(this.c, userId, id);
    if (!entry) return notFound('Entry');
    const { unset = [], quantity, unit, ...rest } = patch;
    const unsetKeys: string[] = [...unset];
    const set: Partial<NewLogEntry> = compact(rest);
    if (quantity != null || unit != null) {
      const q = quantity ?? entry.quantity;
      const u = canonicalUnit(unit ?? entry.unit);
      const item = (await this.lookupFor(userId, [entry]))(entry.kind, entry.refId);
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
    }
    return (await updateLogEntry(this.c, userId, id, set, unsetKeys, this.now())) ?? notFound('Entry');
  }

  deleteEntry(userId: string, id: string) {
    return deleteLogEntry(this.c, userId, id);
  }

  /** "Copy to another day": the same portion, priced from the food as it is now. */
  async copyEntry(userId: string, id: string, to: { date: IsoDate; slot?: string | undefined }): Promise<FoodLogEntry | Failure> {
    const entry = await getLogEntry(this.c, userId, id);
    if (!entry) return notFound('Entry');
    const result = await this.log(userId, [
      { date: to.date, slot: to.slot ?? entry.slot, kind: entry.kind, refId: entry.refId, quantity: entry.quantity, unit: entry.unit, via: 'manual', ...(entry.time ? { time: entry.time } : {}) },
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
  };
}

function normalizeRecipe<T extends Pick<RecipeInput, 'ingredients'>>(r: T): T {
  return { ...r, ingredients: r.ingredients.map((i) => ({ ...i, unit: canonicalUnit(i.unit) })) };
}

function normalizeMeal<T extends Pick<MealInput, 'items'>>(m: T): T {
  return { ...m, items: m.items.map((i) => ({ ...i, unit: canonicalUnit(i.unit) })) };
}
