import type { Food, MealItem, Nutrients, RecipeInput, RecipeTotals } from '@cycling-coach/shared';
import { scaleNutrients, sumNutrients, ZERO_NUTRIENTS } from './nutrients';
import { computePortion, type Loggable } from './portions';
import { roundTo } from './units';

/**
 * A recipe's nutrients, from its ingredient foods as they are now (archived foods still count).
 * Ingredients that can't be counted are reported, not silently dropped.
 */
export function recipeTotals(recipe: Pick<RecipeInput, 'ingredients' | 'servings'>, foodsById: ReadonlyMap<string, Food>): RecipeTotals {
  const parts: Nutrients[] = [];
  const problems: RecipeTotals['problems'] = [];
  let grams = 0;
  let allWeighed = true;
  for (const ing of recipe.ingredients) {
    const food = foodsById.get(ing.foodId);
    if (!food) {
      problems.push({ foodId: ing.foodId, reason: 'missing' });
      allWeighed = false;
      continue;
    }
    const p = computePortion(food, ing.quantity, ing.unit);
    if (!p) {
      problems.push({ foodId: ing.foodId, reason: 'unit' });
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
