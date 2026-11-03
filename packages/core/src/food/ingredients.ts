import type { DraftIngredient, Food, IngredientLine, IngredientMatch, IngredientSuggestion, Nutrients, RecipeInput } from '@cycling-coach/shared';
import { scaleNutrients, sumNutrients, ZERO_NUTRIENTS } from './nutrients';
import { computePortion } from './portions';
import { defaultPortionIndex, foodFromStaple } from './reference';
import { canonicalUnit } from './units';

/**
 * Pricing the coach's recipes (DECISIONS #41). The coach names ingredients and
 * amounts; the numbers come from here — each line priced from one of the user's foods or a staple's
 * per-100 g values, never from the model. Pure: the caller loads the foods.
 */

const FILLER = new Set(['a', 'an', 'the', 'some', 'of', 'and', 'with', 'my', 'usual', 'big', 'small', 'half', 'one', 'two', 'cup', 'cups', 'bowl', 'piece', 'slice', 'serving', 'fresh', 'chopped', 'sliced', 'diced', 'minced']);

/** The words that matter in "a banana" / "Broccoli, chopped" — for the staple search and the check below. */
export const stapleWords = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !FILLER.has(w));

/**
 * The staple search ranks loosely; only use a hit whose name covers every word heard ("granola
 * bar" → "Bars, granola"), so an unknown word ("zorblax bar") gets nothing rather than a guess.
 */
export function stapleCovers(heard: string, name: string): boolean {
  const have = stapleWords(name);
  const want = stapleWords(heard);
  return want.length > 0 && want.every((w) => have.some((h) => h.startsWith(w.replace(/s$/, '')) || w.startsWith(h)));
}

/** What a match is priced from: the food, or the staple as the food it would become. */
function pricedItem(match: IngredientMatch, foodsById: ReadonlyMap<string, Food>) {
  if (match.kind === 'food') return foodsById.get(match.foodId);
  return foodFromStaple(match.detail, { name: match.name, defaultIndex: defaultPortionIndex(match.detail.portions) });
}

/** One line's nutrients for the whole recipe — null with the reason when it can't be counted. */
export function priceIngredient(
  line: IngredientLine & { match: IngredientMatch | null },
  foodsById: ReadonlyMap<string, Food>,
): { nutrients: Nutrients } | { problem: 'unmatched' | 'unit' } | null {
  if (line.toTaste) return null;
  if (!line.match) return { problem: 'unmatched' };
  const item = pricedItem(line.match, foodsById);
  if (!item) return { problem: 'unmatched' };
  const p = computePortion(item, line.quantity, canonicalUnit(line.unit));
  return p ? { nutrients: p.nutrients } : { problem: 'unit' };
}

export interface PricedLines {
  ingredients: DraftIngredient[];
  total: Nutrients;
  /** Lines that aren't counted (and aren't "to taste"). */
  unresolved: number;
  /** Names of the staples in use — saved to the user's foods on Save / Log. */
  staples: string[];
}

/** Every line priced, with the total over the ones that could be. */
export function priceLines(lines: readonly (IngredientLine & { match: IngredientMatch | null; suggestions?: IngredientSuggestion[] | undefined })[], foodsById: ReadonlyMap<string, Food>): PricedLines {
  const parts: Nutrients[] = [];
  let unresolved = 0;
  const ingredients = lines.map((line): DraftIngredient => {
    const priced = priceIngredient(line, foodsById);
    const { kcal: _k, protein: _pr, problem: _p, suggestions, ...base } = line as DraftIngredient;
    if (!priced) return base;
    if ('problem' in priced) {
      unresolved++;
      // Offers only make sense while the line is still unmatched.
      return { ...base, problem: priced.problem, ...(priced.problem === 'unmatched' && suggestions?.length ? { suggestions } : {}) };
    }
    parts.push(priced.nutrients);
    return { ...base, kcal: Math.round(priced.nutrients.kcal), protein: Math.round(priced.nutrients.protein * 10) / 10 };
  });
  const staples = [...new Set(lines.flatMap((l) => (!l.toTaste && l.match?.kind === 'staple' ? [l.match.name] : [])))];
  return { ingredients, total: parts.length ? sumNutrients(parts) : { ...ZERO_NUTRIENTS }, unresolved, staples };
}

/** Per-serving numbers for a priced set of lines. */
export const perServingOf = (total: Nutrients, servings: number) => scaleNutrients(total, 1 / servings);

/**
 * The Library recipe a draft becomes. `foodIdFor` maps each match to a food id — staples to the
 * food just saved for them. "To taste" lines become `toTaste`; every other line must be priced.
 * The coach's name for each line is kept as its `label` (DECISIONS #47).
 */
export function draftToRecipeInput(
  draft: {
    name: string;
    servings: number;
    steps: string[];
    description?: string | undefined;
    minutes?: number | undefined;
    ingredients: readonly (IngredientLine & { match: IngredientMatch | null })[];
  },
  foodIdFor: (m: IngredientMatch) => string,
): RecipeInput {
  const counted = draft.ingredients.filter((l) => !l.toTaste && l.match);
  const toTaste = draft.ingredients.filter((l) => l.toTaste).map((l) => l.name);
  return {
    name: draft.name,
    aliases: [],
    servings: draft.servings,
    ingredients: counted.map((l) => ({ foodId: foodIdFor(l.match!), quantity: l.quantity, unit: canonicalUnit(l.unit), label: l.name })),
    ...(draft.description ? { description: draft.description.slice(0, 300) } : {}),
    ...(draft.minutes ? { minutes: draft.minutes } : {}),
    ...(toTaste.length ? { toTaste } : {}),
    ...(draft.steps.length ? { steps: draft.steps } : {}),
  };
}
