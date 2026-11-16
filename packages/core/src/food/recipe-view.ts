import type { DraftIngredient, Food, Nutrients, Recipe, RecipeInput, RecipeView, RecipeViewLine } from '@cycling-coach/shared';
import { computePortion } from './portions';
import { recipeLine, recipeTotals, type RecipeSource } from './recipes';
import { canonicalUnit, isMassUnit, isVolumeUnit, roundTo } from './units';

/**
 * Reading and cooking a recipe (DECISIONS #47). The view is what the Library recipe page, cook
 * mode and a share link show; `scaleLines` makes it for a different number of servings without
 * touching the saved recipe. Pure.
 */

type ViewRecipe = Pick<RecipeInput, 'name' | 'servings' | 'ingredients' | 'steps' | 'notes' | 'description' | 'minutes' | 'toTaste'> & { id?: string | undefined };

/**
 * A saved recipe as it reads — the recipe's own names where it has them, its foods' otherwise. A line
 * that is another recipe (DECISIONS #113) carries that recipe's own view, so it can be cooked from here.
 */
export function recipeView(
  recipe: ViewRecipe & Partial<Pick<Recipe, 'totals'>>,
  foodsById: ReadonlyMap<string, Food>,
  recipesById: ReadonlyMap<string, RecipeSource & ViewRecipe> = new Map(),
  path: readonly string[] = recipe.id ? [recipe.id] : [],
): RecipeView {
  const totals = recipe.totals ?? recipeTotals(recipe, foodsById, recipesById);
  const ingredients = recipe.ingredients.map((ing): RecipeViewLine => {
    if (ing.recipeId) {
      const sub = recipesById.get(ing.recipeId);
      const line = sub ? recipeLine(path, ing, foodsById, recipesById) : null;
      const priced = line && !('problem' in line) ? line : null;
      return {
        label: ing.label ?? sub?.name ?? 'Unknown recipe',
        quantity: ing.quantity,
        unit: ing.unit,
        ...(priced?.portion ? { kcal: Math.round(priced.portion.nutrients.kcal) } : {}),
        ...(sub && priced
          ? {
              recipe: {
                view: recipeView({ ...sub, totals: priced.totals }, foodsById, recipesById, [...path, sub.id]),
                ...(priced.portion ? { fraction: roundTo(priced.portion.servings / sub.servings, 4) } : {}),
              },
            }
          : {}),
      };
    }
    const food = ing.foodId ? foodsById.get(ing.foodId) : undefined;
    const p = food && computePortion(food, ing.quantity, ing.unit);
    return {
      label: ing.label ?? food?.name ?? 'Unknown ingredient',
      quantity: ing.quantity,
      unit: ing.unit,
      ...(p ? { kcal: Math.round(p.nutrients.kcal) } : {}),
    };
  });
  return {
    name: recipe.name,
    ...(recipe.description ? { description: recipe.description } : {}),
    ...(recipe.minutes ? { minutes: recipe.minutes } : {}),
    servings: recipe.servings,
    ingredients,
    toTaste: recipe.toTaste ?? [],
    steps: recipe.steps ?? [],
    ...(recipe.notes ? { notes: recipe.notes } : {}),
    perServing: totals.perServing,
    uncounted: totals.problems.length,
  };
}

/** A coach draft as the same view, for cook mode before it's saved. */
export function draftRecipeView(draft: {
  name: string;
  description?: string | undefined;
  minutes?: number | undefined;
  servings: number;
  ingredients: readonly DraftIngredient[];
  steps: readonly string[];
  totals: { perServing: Nutrients; unresolved: number };
}): RecipeView {
  return {
    name: draft.name,
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.minutes ? { minutes: draft.minutes } : {}),
    servings: draft.servings,
    ingredients: draft.ingredients
      .filter((l) => !l.toTaste)
      .map((l) => ({ label: l.name, quantity: l.quantity, unit: l.unit, ...(l.kcal != null ? { kcal: l.kcal } : {}) })),
    toTaste: draft.ingredients.filter((l) => l.toTaste).map((l) => l.name),
    steps: [...draft.steps],
    perServing: draft.totals.perServing,
    uncounted: draft.totals.unresolved,
  };
}

const roundToStep = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

/**
 * An amount × `factor`, rounded the way a cook would measure it: grams and millilitres to whole
 * numbers (5s above 50, halves below 10), kilos and litres to 0.05, spoons, cups and counts to ¼.
 */
export function scaleQuantity(quantity: number, unit: string, factor: number): number {
  const q = quantity * factor;
  if (Math.abs(factor - 1) < 1e-9) return quantity;
  const u = canonicalUnit(unit);
  if (u === 'g' || u === 'ml') return q >= 50 ? roundToStep(q, 5) : q >= 10 ? roundToStep(q, 1) : roundToStep(q, 0.5);
  if (u === 'kg' || u === 'l' || u === 'lb') return roundTo(roundToStep(q, 0.05), 2);
  if (isMassUnit(u) || isVolumeUnit(u)) return roundToStep(q, 0.25);
  // Counts ("egg", "clove") and servings.
  return roundToStep(q, 0.25);
}

/** Every line for `to` servings instead of `from`. Lines without an amount stay as they are. */
export function scaleLines<L extends { quantity: number; unit: string }>(lines: readonly L[], from: number, to: number): L[] {
  if (!(from > 0) || !(to > 0)) return [...lines];
  const factor = to / from;
  return lines.map((l) => ({ ...l, quantity: scaleQuantity(l.quantity, l.unit, factor) }));
}
