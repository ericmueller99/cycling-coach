import {
  foodAsLoggable,
  formatPortion,
  recipeAsLoggable,
  usageKey,
  type Loggable,
} from '@cycling-coach/core';
import type { CaloriesLogInput, Food, FoodLibrary, FoodLogEntry, FoodSource, Meal, NutrientKey, Nutrients, Recipe } from '@cycling-coach/shared';

/** Estimates and what needs checking. */
export const AMBER = { bg: '#FEF0C7', fg: '#B54708' } as const;

/** Source tags: Label blue, Photo purple, CNF green, Meal/Recipe orange, Manual grey. */
export const SOURCE_STYLE: Record<FoodSource | 'recipe' | 'meal', { label: string; bg: string; fg: string }> = {
  label: { label: 'Label', bg: '#EEF4FF', fg: '#1D5BBF' },
  screenshot: { label: 'Photo', bg: '#F4F3FF', fg: '#5925DC' },
  cnf: { label: 'CNF', bg: '#ECFDF3', fg: '#085D3A' },
  usda: { label: 'USDA', bg: '#EEF0F3', fg: '#4B5563' },
  off: { label: 'OFF', bg: '#E6F6F4', fg: '#0E7468' },
  manual: { label: 'Manual', bg: '#EEF0F3', fg: '#4B5563' },
  estimate: { label: 'Estimate', bg: AMBER.bg, fg: AMBER.fg },
  recipe: { label: 'Recipe', bg: '#FFF4E5', fg: '#B54708' },
  meal: { label: 'Meal', bg: '#FFF4E5', fg: '#B54708' },
};

/** Where a food came from, for its detail line. */
export const SOURCE_LINE: Record<FoodSource, string> = {
  label: 'Added from a nutrition label',
  screenshot: 'Added from a screenshot',
  cnf: 'Canadian Nutrient File (Health Canada)',
  usda: 'USDA FoodData Central',
  off: 'Open Food Facts',
  manual: 'Entered by hand',
  estimate: 'Estimated by AI from a restaurant meal',
};

/** Macro colours. */
export const MACRO_COLOR = { protein: '#3B8BF6', carbs: '#E9B80F', fat: '#F5782A' } as const;

export const fmtKcal = (n: number) => Math.round(n).toLocaleString('en-US');
export const fmtG = (n: number) => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));

/** "1 bagel · 95 g" for a log row. */
export function entryPortion(e: Pick<FoodLogEntry, 'quantity' | 'unit' | 'grams'>): string {
  const base = formatPortion(e.quantity, e.unit);
  return e.grams != null && e.unit !== 'g' ? `${base} · ${Math.round(e.grams)} g` : base;
}

/** "P 9 · C 52 · F 2" */
export const macroLine = (n: Nutrients) => `P ${fmtG(n.protein)} · C ${fmtG(n.carbs)} · F ${fmtG(n.fat)}`;

/** The line under an entry's name. A `calories` entry has no portion, and blank macros aren't zeros to show. */
export function entryLine(e: Pick<FoodLogEntry, 'kind' | 'quantity' | 'unit' | 'grams' | 'nutrients' | 'estimate'>): string {
  if (e.estimate) return `likely ${fmtKcal(e.estimate.low)}–${fmtKcal(e.estimate.high)} · ${macroLine(e.nutrients)}`;
  if (e.kind !== 'calories') return `${entryPortion(e)} · ${macroLine(e.nutrients)}`;
  return e.nutrients.protein || e.nutrients.carbs || e.nutrients.fat ? macroLine(e.nutrients) : 'kcal only';
}

/** Goes in front of any total that includes an estimate. */
export const approx = (estimates: number) => (estimates > 0 ? '≈ ' : '');
export const includesEstimates = (n: number) => `Includes ${n === 1 ? '1 estimate' : `${n} estimates`}`;

/** The rows of the Calories form, before "More nutrients". */
export const CALORIES_ROWS: readonly NutrientKey[] = ['protein', 'carbs', 'fat', 'alcohol'];

export type CaloriesDraft = Partial<Record<NutrientKey, string>>;

/** Blank is left out. Null until there's a usable kcal, or when anything typed isn't a number. */
export function parseCalories(draft: CaloriesDraft): CaloriesLogInput['nutrients'] | null {
  const out: Partial<Record<NutrientKey, number>> = {};
  for (const [key, raw] of Object.entries(draft) as [NutrientKey, string | undefined][]) {
    const text = raw?.trim();
    if (!text) continue;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return null;
    out[key] = n;
  }
  return out.kcal == null ? null : { ...out, kcal: out.kcal };
}

/** What the form shows for a logged entry. A 0 that was left blank comes back blank. */
export function caloriesDraft(n: Nutrients): CaloriesDraft {
  return Object.fromEntries(Object.entries(n).filter(([k, v]) => v != null && (k === 'kcal' || v !== 0)).map(([k, v]) => [k, String(v)]));
}

/** One searchable, loggable thing in the Log food dialog. */
export type LibraryItem =
  | { kind: 'food'; id: string; name: string; brand?: string | undefined; aliases: string[]; food: Food; loggable: Loggable }
  | { kind: 'recipe'; id: string; name: string; aliases: string[]; recipe: Recipe; loggable: Loggable }
  | { kind: 'meal'; id: string; name: string; aliases: string[]; meal: Meal };

/** Everything active in the library, as search items. */
export function libraryItems(lib: FoodLibrary): LibraryItem[] {
  return [
    ...lib.foods
      .filter((f) => !f.archived)
      .map((f): LibraryItem => ({ kind: 'food', id: f.id, name: f.name, brand: f.brand, aliases: f.aliases, food: f, loggable: foodAsLoggable(f) })),
    ...lib.recipes
      .filter((r) => !r.archived)
      .map((r): LibraryItem => ({ kind: 'recipe', id: r.id, name: r.name, aliases: r.aliases, recipe: r, loggable: recipeAsLoggable(r) })),
    ...lib.meals.filter((m) => !m.archived).map((m): LibraryItem => ({ kind: 'meal', id: m.id, name: m.name, aliases: m.aliases, meal: m })),
  ];
}

export const itemUsage = (lib: FoodLibrary, item: Pick<LibraryItem, 'kind' | 'id'>) => lib.usage[usageKey(item.kind, item.id)];

/** Loggable by kind + id, for meal items and log rows. */
export function findLoggable(lib: FoodLibrary, kind: 'food' | 'recipe', id: string): Loggable | undefined {
  if (kind === 'food') {
    const f = lib.foods.find((x) => x.id === id);
    return f ? foodAsLoggable(f) : undefined;
  }
  const r = lib.recipes.find((x) => x.id === id);
  return r ? recipeAsLoggable(r) : undefined;
}

/** The current local time as HH:MM, for a new entry's time. */
export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "7:40 AM" from "07:40". */
export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Canadian Nutrition Facts order. */
export const NUTRIENT_ROWS: { key: NutrientKey; label: string; unit: string; sub?: boolean; required?: boolean }[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', required: true },
  { key: 'fat', label: 'Fat', unit: 'g', required: true },
  { key: 'satFat', label: 'Saturated', unit: 'g', sub: true },
  { key: 'transFat', label: 'Trans', unit: 'g', sub: true },
  { key: 'carbs', label: 'Carbohydrate', unit: 'g', required: true },
  { key: 'fibre', label: 'Fibre', unit: 'g', sub: true },
  { key: 'sugars', label: 'Sugars', unit: 'g', sub: true },
  { key: 'protein', label: 'Protein', unit: 'g', required: true },
  { key: 'cholesterolMg', label: 'Cholesterol', unit: 'mg' },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg' },
  { key: 'potassiumMg', label: 'Potassium', unit: 'mg' },
  { key: 'calciumMg', label: 'Calcium', unit: 'mg' },
  { key: 'ironMg', label: 'Iron', unit: 'mg' },
  { key: 'alcohol', label: 'Alcohol', unit: 'g' },
];
