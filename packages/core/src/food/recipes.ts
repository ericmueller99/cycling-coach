import { MAX_RECIPE_DEPTH, type Food, type MealItem, type Nutrients, type RecipeIngredient, type RecipeInput, type RecipeProblem, type RecipeTotals } from '@cycling-coach/shared';
import { scaleNutrients, sumNutrients, ZERO_NUTRIENTS } from './nutrients';
import { computePortion, recipeAsLoggable, type Loggable, type PortionResult } from './portions';
import { roundTo } from './units';

/** A recipe as nested recipes need it: its own fields, without totals (those are computed). */
export type RecipeSource = Pick<RecipeInput, 'name' | 'ingredients' | 'servings' | 'finishedGrams' | 'finishedVolume'> & { id: string };

/** What a recipe line priced at: the sub-recipe's totals and the portion of it used. */
export interface SubLine {
  sub: RecipeSource;
  totals: RecipeTotals;
  portion: PortionResult | null;
}

/**
 * A recipe's nutrients, from its ingredient foods as they are now (archived foods still count), and from
 * the recipes it uses as ingredients (DECISIONS #113), computed the same way all the way down. A recipe
 * that would contain itself, or sits deeper than `MAX_RECIPE_DEPTH`, isn't counted.
 * Ingredients that can't be counted are reported, not silently dropped.
 */
export function recipeTotals(
  recipe: Pick<RecipeInput, 'ingredients' | 'servings'> & { id?: string | undefined },
  foodsById: ReadonlyMap<string, Food>,
  recipesById: ReadonlyMap<string, RecipeSource> = new Map(),
): RecipeTotals {
  return new RecipeMaths(foodsById, recipesById).totals(recipe, recipe.id ? [recipe.id] : []);
}

/**
 * The sub-recipe a line uses, priced, or why it can't be — for views that show the line. `path` is the
 * ids of the recipes above the line, the top one first.
 */
export function recipeLine(
  path: readonly string[],
  ing: RecipeIngredient,
  foodsById: ReadonlyMap<string, Food>,
  recipesById: ReadonlyMap<string, RecipeSource>,
): SubLine | { problem: RecipeProblem } | null {
  if (!ing.recipeId) return null;
  return new RecipeMaths(foodsById, recipesById).subLine(ing.recipeId, ing, path);
}

class RecipeMaths {
  private readonly memo = new Map<string, RecipeTotals>();
  constructor(
    private readonly foodsById: ReadonlyMap<string, Food>,
    private readonly recipesById: ReadonlyMap<string, RecipeSource>,
  ) {}

  totals(recipe: Pick<RecipeInput, 'ingredients' | 'servings'>, path: readonly string[]): RecipeTotals {
    const parts: Nutrients[] = [];
    const problems: RecipeProblem[] = [];
    let grams = 0;
    let allWeighed = true;
    for (const ing of recipe.ingredients) {
      if (ing.recipeId) {
        const line = this.subLine(ing.recipeId, ing, path);
        if ('problem' in line) {
          problems.push(line.problem);
          allWeighed = false;
          continue;
        }
        const { totals, portion } = line;
        if (!portion) {
          problems.push({ recipeId: ing.recipeId, reason: 'unit' });
          allWeighed = false;
          continue;
        }
        if (totals.problems.length) problems.push({ recipeId: ing.recipeId, reason: 'incomplete' });
        parts.push(portion.nutrients);
        if (portion.grams != null) grams += portion.grams;
        else allWeighed = false;
        continue;
      }
      const foodId = ing.foodId ?? '';
      const food = this.foodsById.get(foodId);
      if (!food) {
        problems.push({ foodId, reason: 'missing' });
        allWeighed = false;
        continue;
      }
      const p = computePortion(food, ing.quantity, ing.unit);
      if (!p) {
        problems.push({ foodId, reason: 'unit' });
        allWeighed = false;
        continue;
      }
      parts.push(p.nutrients);
      if (p.grams != null) grams += p.grams;
      else allWeighed = false;
    }
    const total = parts.length ? sumNutrients(parts) : { ...ZERO_NUTRIENTS };
    return {
      total,
      perServing: scaleNutrients(total, 1 / recipe.servings),
      ...(allWeighed && recipe.ingredients.length ? { rawGrams: roundTo(grams, 1) } : {}),
      problems,
    };
  }

  /** `path` is the recipes above this line, the top one first. */
  subLine(recipeId: string, ing: Pick<RecipeIngredient, 'quantity' | 'unit'>, path: readonly string[]): SubLine | { problem: RecipeProblem } {
    if (path.includes(recipeId)) return { problem: { recipeId, reason: 'cycle' } };
    if (path.length > MAX_RECIPE_DEPTH) return { problem: { recipeId, reason: 'depth' } };
    const sub = this.recipesById.get(recipeId);
    if (!sub) return { problem: { recipeId, reason: 'missing' } };
    let totals = this.memo.get(recipeId);
    if (!totals) {
      totals = this.totals(sub, [...path, recipeId]);
      // A cycle below this recipe depends on the path, so only clean results are reused.
      if (!totals.problems.some((p) => p.reason === 'cycle' || p.reason === 'depth' || p.reason === 'incomplete')) this.memo.set(recipeId, totals);
    }
    const portion = computePortion(recipeAsLoggable({ ...sub, totals }), ing.quantity, ing.unit);
    return { sub, totals, portion };
  }
}

/**
 * Every recipe and food a recipe needs to be priced, found level by level through `getRecipes` (which the
 * caller backs with the database). Stops at `MAX_RECIPE_DEPTH` and at recipes it has already seen.
 */
export async function loadRecipeClosure<R extends RecipeSource>(
  roots: readonly Pick<RecipeInput, 'ingredients'>[],
  getRecipes: (ids: string[]) => Promise<R[]>,
): Promise<{ recipesById: Map<string, R>; foodIds: string[] }> {
  const recipesById = new Map<string, R>();
  const foodIds = new Set<string>();
  let level: Pick<RecipeInput, 'ingredients'>[] = [...roots];
  for (let depth = 0; depth <= MAX_RECIPE_DEPTH + 1 && level.length; depth++) {
    const want = new Set<string>();
    for (const r of level) {
      for (const ing of r.ingredients) {
        if (ing.foodId) foodIds.add(ing.foodId);
        if (ing.recipeId && !recipesById.has(ing.recipeId)) want.add(ing.recipeId);
      }
    }
    const found = want.size ? await getRecipes([...want]) : [];
    for (const r of found) recipesById.set(r.id, r);
    level = found;
  }
  return { recipesById, foodIds: [...foodIds] };
}

/**
 * Would saving `ingredients` on recipe `selfId` make it contain itself? `recipesById` needs the recipes
 * reachable from those ingredients (`loadRecipeClosure`).
 */
export function wouldCycle(selfId: string, ingredients: readonly RecipeIngredient[], recipesById: ReadonlyMap<string, Pick<RecipeInput, 'ingredients'>>): boolean {
  const seen = new Set<string>();
  const stack = ingredients.flatMap((i) => (i.recipeId ? [i.recipeId] : []));
  while (stack.length) {
    const id = stack.pop()!;
    if (id === selfId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const i of recipesById.get(id)?.ingredients ?? []) if (i.recipeId) stack.push(i.recipeId);
  }
  return false;
}

/** The ids of recipes that use `recipeId` directly or further down — what it must not contain. */
export function recipesUsing(recipeId: string, recipes: readonly (Pick<RecipeInput, 'ingredients'> & { id: string })[]): Set<string> {
  const users = new Set<string>([recipeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of recipes) {
      if (!users.has(r.id) && r.ingredients.some((i) => i.recipeId && users.has(i.recipeId))) {
        users.add(r.id);
        grew = true;
      }
    }
  }
  return users;
}

/** A saved meal's total at its saved portions (× `scale` for a partial meal). Unknown items count as nothing. */
export function mealTotal(items: readonly MealItem[], lookup: (kind: MealItem['kind'], id: string) => Loggable | undefined, scale = 1): Nutrients {
  const parts: Nutrients[] = [];
  for (const it of items) {
    const item = lookup(it.kind, it.refId);
    const p = item && computePortion(item, it.quantity * scale, it.unit);
    if (p) parts.push(p.nutrients);
  }
  return parts.length ? sumNutrients(parts) : { ...ZERO_NUTRIENTS };
}
