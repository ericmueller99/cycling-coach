import { loadRecipeClosure, recipeTotals } from '@cycling-coach/core';
import { getFoodsByIds, getRecipesByIds, type Collections, type StoredRecipe } from '@cycling-coach/db';
import type { Food, Recipe, RecipeInput } from '@cycling-coach/shared';

/**
 * What it takes to price some recipes: every recipe they use as an ingredient, all the way down
 * (DECISIONS #113), and every food any of them uses. One query per level, then one for the foods.
 */
export async function recipeContext(
  c: Collections,
  userId: string,
  roots: readonly Pick<RecipeInput, 'ingredients'>[],
  extraFoodIds: readonly string[] = [],
): Promise<{ foodsById: Map<string, Food>; recipesById: Map<string, StoredRecipe> }> {
  const { recipesById, foodIds } = await loadRecipeClosure(roots, (ids) => getRecipesByIds(c, userId, ids));
  const foods = await getFoodsByIds(c, userId, [...new Set([...foodIds, ...extraFoodIds])]);
  return { foodsById: new Map(foods.map((f) => [f.id, f])), recipesById };
}

export function withTotals(r: StoredRecipe, foodsById: ReadonlyMap<string, Food>, recipesById: ReadonlyMap<string, StoredRecipe>): Recipe {
  return { ...r, totals: recipeTotals(r, foodsById, recipesById) };
}
