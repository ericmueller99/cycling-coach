import { z } from 'zod';
import { isoDateSchema, type IsoDate } from './common';
import { foodUnitSchema, stapleSources, timeOfDaySchema, type FoodSource, type Nutrients, type StapleDetail } from './food';

/**
 * Meal ideas and recipes the coach builds in chat (DECISIONS #41). The coach writes
 * names, amounts and steps; nutrition is never AI-estimated — each ingredient is matched to one of
 * the user's foods (or a Canadian staple) and priced by `core`. Ideas and recipes are drafts: nothing
 * reaches their foods, recipes or log until they press Log or Save as recipe.
 */

/** One ingredient as the coach wrote it. */
export const ingredientLineSchema = z.object({
  name: z.string().trim().min(1).max(80).describe('Plain ingredient name, e.g. "Chicken thighs, boneless skinless".'),
  quantity: z.number().positive().max(10_000).describe('Amount of the unit for the WHOLE recipe (all servings).'),
  unit: foodUnitSchema.describe('Prefer g for solids and ml for liquids; tbsp/tsp/cup or a count ("egg") are fine.'),
  toTaste: z.boolean().describe('True only for salt, pepper, dried spices, herbs and squeezes of lemon — they are not counted.'),
});
export type IngredientLine = z.infer<typeof ingredientLineSchema>;

/** What an ingredient was priced from. A staple stays reference data until the user saves the recipe. */
export type IngredientMatch =
  | { kind: 'food'; foodId: string; name: string; source: FoodSource }
  | { kind: 'staple'; source: StapleDetail['source']; ref: string; name: string; detail: StapleDetail };

/** A match offered for an unmatched line in the Details pane — the user's foods first, then CNF staples. */
export type IngredientSuggestion =
  | { kind: 'food'; foodId: string; name: string; source: FoodSource }
  | { kind: 'staple'; source: StapleDetail['source']; ref: string; name: string };

export interface DraftIngredient extends IngredientLine {
  match: IngredientMatch | null;
  /** For the whole recipe, when it could be priced. */
  kcal?: number | undefined;
  /** Grams of protein for the whole recipe, when it could be priced. */
  protein?: number | undefined;
  /** Up to 3 offered matches while the line is unmatched (meal ideas only). */
  suggestions?: IngredientSuggestion[] | undefined;
  /** `unmatched`: not in the user's foods and no staple fits; `unit`: matched, but that unit doesn't fit the food. */
  problem?: 'unmatched' | 'unit' | undefined;
}

export interface MealIdea {
  /** "Best fit", "Fastest", "Most protein". */
  tag: string;
  name: string;
  description: string;
  minutes: number;
  servings: number;
  ingredients: DraftIngredient[];
  /** Null when nothing could be priced. */
  perServing: Nutrients | null;
  /** Ingredient names that aren't counted in `perServing`. */
  unpriced: string[];
  // Preview for the Details pane. Optional: ideas made before Nov 2 don't have them.
  difficulty?: MealDifficulty | undefined;
  equipment?: string[] | undefined;
  leftovers?: string | undefined;
  /** Why it fits the athlete's day, in words — never numbers (the app computes those). */
  why?: string | undefined;
  /** 3–5 short preview steps; the full recipe comes from build_recipe. */
  steps?: string[] | undefined;
}

export const mealDifficulties = ['Easy', 'Medium', 'Hard'] as const;
export type MealDifficulty = (typeof mealDifficulties)[number];

export interface MealIdeas {
  id: string;
  threadId: string;
  slot: string;
  date: IsoDate;
  ideas: MealIdea[];
  followUps: string[];
  /** Ideas the user picked — a recipe was built from them. */
  picked: number[];
  /** The kcal range they asked for ("650–800 calories"), when they named one. */
  kcalRange?: { min: number; max: number } | undefined;
  createdAt: string;
}

/**
 * Pick a match for an unmatched ingredient in the Details pane. A staple is saved to the
 * user's foods (their click). The match applies to every unmatched line of that name across the ideas.
 * No defaults (rule 1b).
 */
export const mealIdeaFixSchema = z
  .object({
    idea: z.number().int().min(0).max(3),
    ingredient: z.number().int().min(0).max(39),
    foodId: z.string().min(1).optional(),
    staple: z.object({ source: z.enum(stapleSources), ref: z.string().min(1).max(40) }).optional(),
  })
  .refine((v) => (v.foodId ? 1 : 0) + (v.staple ? 1 : 0) === 1, { message: 'Pick a food or a staple.' });
export type MealIdeaFix = z.infer<typeof mealIdeaFixSchema>;

export interface RecipeDraftLog {
  date: IsoDate;
  slot: string;
  quantity: number;
  kcal: number;
  entryId: string;
  at: string;
}

export interface RecipeDraft {
  id: string;
  threadId: string;
  ideasId?: string | undefined;
  ideaIndex?: number | undefined;
  name: string;
  description?: string | undefined;
  servings: number;
  minutes?: number | undefined;
  ingredients: DraftIngredient[];
  steps: string[];
  /** Set once saved (Save as recipe, or the first Log) — then it's a normal Library recipe. */
  recipeId?: string | undefined;
  logged: RecipeDraftLog[];
  totals: {
    perServing: Nutrients;
    total: Nutrients;
    /** Lines still to resolve before it can be saved or logged. */
    unresolved: number;
    /** Staples that Save / Log will add to the user's foods. */
    staples: string[];
  };
  createdAt: string;
}

/** Fix one ingredient (pick a food or staple, change the amount, drop it) or the servings. No defaults (rule 1b). */
export const recipeDraftPatchSchema = z.object({
  servings: z.number().positive().max(50).optional(),
  ingredient: z
    .object({
      index: z.number().int().min(0).max(59),
      foodId: z.string().min(1).optional(),
      staple: z.object({ source: z.enum(stapleSources), ref: z.string().min(1).max(40) }).optional(),
      quantity: z.number().positive().max(10_000).optional(),
      unit: foodUnitSchema.optional(),
      toTaste: z.boolean().optional(),
      remove: z.boolean().optional(),
    })
    .optional(),
});
export type RecipeDraftPatch = z.infer<typeof recipeDraftPatchSchema>;

export const recipeDraftLogSchema = z.object({
  quantity: z.number().positive().max(20),
  slot: z.string().trim().min(1).max(30),
  date: isoDateSchema,
  time: timeOfDaySchema.optional(),
});
export type RecipeDraftLogInput = z.infer<typeof recipeDraftLogSchema>;

export interface RecipeDraftSaved {
  draft: RecipeDraft;
  recipeId: string;
}
