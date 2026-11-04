import { z } from 'zod';
import { isoDateSchema, type IsoDate } from './common';

/**
 * Food module (DECISIONS #33). The user's own foods database: it starts empty and only
 * grows when they add something — a staple from the Canadian Nutrient File / USDA, a label or
 * screenshot read by a small model, an Open Food Facts barcode hit, or by hand. Logging is then
 * always from this database, never AI.
 *
 * Units model: a food stores its nutrients for ONE reference serving, exactly as the source gave
 * them ("per 3/4 cup (175 g)", "per 100 g", "per grande"). `measures` lists everything that equals
 * that serving — `[{ unit: 'g', amount: 175 }, { unit: 'cup', amount: 0.75 }]` — and core does all
 * the portion maths from there (`core.toServings`).
 */

/** A unit: standard (g, kg, oz, lb, ml, l, tsp, tbsp, cup, fl_oz), `serving`, or a label ("bagel"). */
export const foodUnitSchema = z.string().trim().min(1).max(30);

/** One reference serving equals `amount` of `unit`. */
export const measureSchema = z.object({
  unit: foodUnitSchema,
  amount: z.number().positive().max(100_000),
});
export type Measure = z.infer<typeof measureSchema>;

export const portionSchema = z.object({
  quantity: z.number().positive().max(100_000),
  unit: foodUnitSchema,
});
export type Portion = z.infer<typeof portionSchema>;

/** Canadian Nutrition Facts order. Macros in g, the rest as named. */
export const nutrientsSchema = z.object({
  kcal: z.number().min(0).max(50_000),
  fat: z.number().min(0).max(5_000),
  satFat: z.number().min(0).max(5_000).optional(),
  transFat: z.number().min(0).max(5_000).optional(),
  carbs: z.number().min(0).max(5_000),
  fibre: z.number().min(0).max(5_000).optional(),
  sugars: z.number().min(0).max(5_000).optional(),
  protein: z.number().min(0).max(5_000),
  cholesterolMg: z.number().min(0).max(100_000).optional(),
  sodiumMg: z.number().min(0).max(100_000).optional(),
  potassiumMg: z.number().min(0).max(100_000).optional(),
  calciumMg: z.number().min(0).max(100_000).optional(),
  ironMg: z.number().min(0).max(10_000).optional(),
});
export type Nutrients = z.infer<typeof nutrientsSchema>;
export const nutrientKeys = [
  'kcal', 'fat', 'satFat', 'transFat', 'carbs', 'fibre', 'sugars', 'protein',
  'cholesterolMg', 'sodiumMg', 'potassiumMg', 'calciumMg', 'ironMg',
] as const satisfies readonly (keyof Nutrients)[];
export type NutrientKey = (typeof nutrientKeys)[number];

/**
 * Where a food came from — drives the source tag in lists. `label` and `screenshot` were read from
 * a photo by the small model; `cnf` = Canadian Nutrient File; `off` = Open Food Facts (barcode).
 */
export const foodSources = ['label', 'screenshot', 'cnf', 'usda', 'off', 'manual'] as const;
export type FoodSource = (typeof foodSources)[number];

/** UPC / EAN digits. Normalised to EAN-13 where possible (`core.normalizeBarcode`). */
export const barcodeSchema = z.string().regex(/^\d{8,14}$/, 'Expected 8–14 digits');

export const foodImageKinds = ['label', 'screenshot', 'front', 'other'] as const;
export const foodImageRefSchema = z.object({
  /** Object key in the S3 bucket (`cycling-coach/food-images/<userId>/…`). */
  key: z.string().min(1).max(200),
  kind: z.enum(foodImageKinds),
});
export type FoodImageRef = z.infer<typeof foodImageRefSchema>;

/** Food fields without defaults — Zod applies defaults inside `.partial()` (CLAUDE.md rule 1b). */
const foodFields = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).optional(),
  /** Other names for "log with words" and search ("greek yogurt", "skyr"). */
  aliases: z.array(z.string().trim().min(1).max(60)).max(20),
  barcodes: z.array(barcodeSchema).max(10),
  source: z.enum(foodSources),
  /** CNF food code, USDA fdcId, Open Food Facts code. */
  sourceRef: z.string().max(80).optional(),
  /** The reference serving as the source wrote it, e.g. "3/4 cup (175 g)", "100 g", "1 grande". */
  servingLabel: z.string().trim().max(80).optional(),
  /** Everything that equals one reference serving. At least one. */
  measures: z.array(measureSchema).min(1).max(20),
  /** What the portion picker starts at before there's any history. */
  defaultPortion: portionSchema,
  /** Per ONE reference serving. */
  nutrients: nutrientsSchema,
  notes: z.string().max(500).optional(),
  images: z.array(foodImageRefSchema).max(4),
});
export const foodInputSchema = foodFields.extend({
  aliases: foodFields.shape.aliases.default([]),
  barcodes: foodFields.shape.barcodes.default([]),
  images: foodFields.shape.images.default([]),
});
export type FoodInput = z.infer<typeof foodInputSchema>;
/** A partial update; `unset` clears optional fields (JSON can't send `undefined`). */
export const foodPatchSchema = foodFields.partial().extend({
  unset: z.array(z.enum(['brand', 'sourceRef', 'servingLabel', 'notes'])).optional(),
});
export type FoodPatch = z.infer<typeof foodPatchSchema>;

export interface FoodImage extends FoodImageRef {
  createdAt: string;
}

export interface Food extends Omit<FoodInput, 'images'> {
  id: string;
  images: FoodImage[];
  /** Archived foods stay so recipes, meals and history keep working; they're hidden from search. */
  archived?: boolean | undefined;
  createdAt: string;
  updatedAt: string;
}

// ── Recipes & meals ───────────────────────────────────────────────────────

export const recipeIngredientSchema = z.object({
  foodId: z.string().min(1),
  quantity: z.number().positive().max(100_000),
  unit: foodUnitSchema,
  /** How the recipe names it ("chicken thighs") when that's friendlier than the food's name. */
  label: z.string().trim().min(1).max(80).optional(),
});
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;

const recipeFields = z.object({
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(60)).max(20),
  /** How many servings the recipe makes. */
  servings: z.number().positive().max(200),
  /** Cooked weight of the whole batch, so a batch can be logged by weight. */
  finishedGrams: z.number().positive().max(100_000).optional(),
  ingredients: z.array(recipeIngredientSchema).min(1).max(60),
  notes: z.string().max(2000).optional(),
  /** The method, one step per line (coach-generated recipes always have it). Inline markdown (bold) allowed. */
  steps: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  /** One line on what it is (coach recipes). */
  description: z.string().trim().min(1).max(300).optional(),
  /** Total time, prep to plate. */
  minutes: z.number().int().positive().max(1440).optional(),
  /** Uncounted seasonings: salt, pepper, dried spices, herbs, lemon. */
  toTaste: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});
export const recipeInputSchema = recipeFields.extend({ aliases: recipeFields.shape.aliases.default([]) });
export type RecipeInput = z.infer<typeof recipeInputSchema>;
export const recipePatchSchema = recipeFields.partial().extend({
  unset: z.array(z.enum(['finishedGrams', 'notes', 'steps', 'description', 'minutes', 'toTaste'])).optional(),
});
export type RecipePatch = z.infer<typeof recipePatchSchema>;

/**
 * A recipe as it's read and cooked from (DECISIONS #47): the Library recipe page, cook mode and a
 * share link. Amounts are for `servings`; scale them with `core.scaleLines`. No ids — it goes out
 * on public share links (DECISIONS #48).
 */
export interface RecipeViewLine {
  label: string;
  quantity: number;
  unit: string;
  /** For the whole recipe, when it could be counted. */
  kcal?: number | undefined;
}
export interface RecipeView {
  name: string;
  description?: string | undefined;
  minutes?: number | undefined;
  servings: number;
  ingredients: RecipeViewLine[];
  toTaste: string[];
  steps: string[];
  notes?: string | undefined;
  perServing: Nutrients;
  /** Lines that couldn't be counted, so the numbers are a floor. */
  uncounted: number;
}

/** A live, revocable public link to one recipe. */
export interface RecipeShare {
  token: string;
  url: string;
  createdAt: string;
}

export interface RecipeDetail {
  recipe: Recipe;
  view: RecipeView;
  share: RecipeShare | null;
}

/** What `/r/:token` gets — no ids, no account data beyond the sharer's first name. */
export interface SharedRecipe {
  view: RecipeView;
  sharedBy: string;
  updatedAt: string;
}

/** Computed from the current ingredient foods every time it's read. */
export interface RecipeTotals {
  total: Nutrients;
  perServing: Nutrients;
  /** Sum of ingredient weights, when every ingredient has one. */
  rawGrams?: number | undefined;
  /** Ingredients that couldn't be counted (food missing, or a unit it doesn't have). */
  problems: { foodId: string; reason: 'missing' | 'unit' }[];
}

export interface Recipe extends RecipeInput {
  id: string;
  archived?: boolean | undefined;
  totals: RecipeTotals;
  createdAt: string;
  updatedAt: string;
}

export const loggableKinds = ['food', 'recipe'] as const;
export type LoggableKind = (typeof loggableKinds)[number];

export const mealItemSchema = z.object({
  kind: z.enum(loggableKinds),
  refId: z.string().min(1),
  quantity: z.number().positive().max(100_000),
  unit: foodUnitSchema,
});
export type MealItem = z.infer<typeof mealItemSchema>;

const mealFields = z.object({
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(60)).max(20),
  /** The slot it's usually eaten in, e.g. "Breakfast". */
  slot: z.string().trim().min(1).max(30).optional(),
  items: z.array(mealItemSchema).min(1).max(40),
});
export const mealInputSchema = mealFields.extend({ aliases: mealFields.shape.aliases.default([]) });
export type MealInput = z.infer<typeof mealInputSchema>;
export const mealPatchSchema = mealFields.partial().extend({ unset: z.array(z.enum(['slot'])).optional() });
export type MealPatch = z.infer<typeof mealPatchSchema>;

export interface Meal extends MealInput {
  id: string;
  archived?: boolean | undefined;
  /** At the saved portions, from the current foods and recipes. */
  total: Nutrients;
  createdAt: string;
  updatedAt: string;
}

// ── The log ───────────────────────────────────────────────────────────────

export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
/** `coach` = logged from a recipe the coach built in chat. */
export const foodLogVias = ['manual', 'words', 'meal', 'scan', 'coach'] as const;

export const foodLogInputSchema = z.object({
  date: isoDateSchema,
  slot: z.string().trim().min(1).max(30),
  time: timeOfDaySchema.optional(),
  kind: z.enum(loggableKinds),
  refId: z.string().min(1),
  quantity: z.number().positive().max(100_000),
  unit: foodUnitSchema,
  via: z.enum(foodLogVias),
  fromMealId: z.string().min(1).optional(),
});
export type FoodLogInput = z.infer<typeof foodLogInputSchema>;
export const foodLogBulkSchema = z.object({ entries: z.array(foodLogInputSchema).min(1).max(60) });

/** Edit portion, move to another slot or day. No defaults (rule 1b). */
export const foodLogPatchSchema = z.object({
  date: isoDateSchema.optional(),
  slot: z.string().trim().min(1).max(30).optional(),
  time: timeOfDaySchema.optional(),
  quantity: z.number().positive().max(100_000).optional(),
  unit: foodUnitSchema.optional(),
  unset: z.array(z.enum(['time'])).optional(),
});
export type FoodLogPatch = z.infer<typeof foodLogPatchSchema>;

export const foodLogCopySchema = z.object({ date: isoDateSchema, slot: z.string().trim().min(1).max(30).optional() });

export interface FoodLogEntry {
  id: string;
  date: IsoDate;
  slot: string;
  time?: string | undefined;
  kind: LoggableKind;
  refId: string;
  /** Snapshots at log time — editing the food later never rewrites history. */
  name: string;
  brand?: string | undefined;
  source: FoodSource | 'recipe';
  quantity: number;
  unit: string;
  /** Reference servings this portion is. */
  servings: number;
  grams?: number | undefined;
  nutrients: Nutrients;
  via: (typeof foodLogVias)[number];
  fromMealId?: string | undefined;
  createdAt: string;
}

export const foodLogRangeQuerySchema = z.object({ from: isoDateSchema, to: isoDateSchema });

export interface FoodLogPayload {
  entries: FoodLogEntry[];
}

// ── Settings & library ────────────────────────────────────────────────────

export const foodSlotSchema = z.object({
  name: z.string().trim().min(1).max(30),
  /** Typical time, shown in the section header and used as the default log time. */
  time: timeOfDaySchema.optional(),
});
export type FoodSlot = z.infer<typeof foodSlotSchema>;
export const foodSettingsSchema = z.object({ slots: z.array(foodSlotSchema).min(1).max(10) });
export type FoodSettings = z.infer<typeof foodSettingsSchema>;
/** Workout fuel (any exercise) sits after Dinner. */
export const DEFAULT_FOOD_SLOTS: FoodSlot[] = [
  { name: 'Breakfast', time: '07:30' },
  { name: 'Lunch', time: '12:30' },
  { name: 'Dinner', time: '18:30' },
  { name: 'Workout fuel' },
  { name: 'Snacks' },
];

/** "Usually 1 bagel (6 of 6)". */
export interface PortionHint extends Portion {
  times: number;
  of: number;
}

export interface FoodUsage {
  count: number;
  lastDate: IsoDate;
  usual: PortionHint;
  /** The usual portion in each slot it's been logged in. */
  bySlot: Record<string, PortionHint>;
}

/**
 * Everything the client needs to search and log — a user's foods are a few hundred at most, so the
 * whole library is one cached payload and search runs locally (`core.searchLibrary`).
 */
export interface FoodLibrary {
  foods: Food[];
  recipes: Recipe[];
  meals: Meal[];
  /** Keyed `food:<id>` / `recipe:<id>` / `meal:<id>`, over the last 180 days. */
  usage: Record<string, FoodUsage>;
  settings: FoodSettings;
}

// ── BMR & body composition (Athlete page) ─────────────────────────────────

export const bmrSources = ['measured', 'scan', 'formula', 'other'] as const;
export type BmrSource = (typeof bmrSources)[number];

export const activityModes = ['steps', 'factor'] as const;
export const exerciseSources = ['power', 'device'] as const;

const energyFields = z.object({
  /** Basal / resting metabolic rate, kcal per day. */
  bmrKcal: z.number().int().min(500).max(5000),
  bmrSource: z.enum(bmrSources),
  bmrDate: isoDateSchema,
  bmrNote: z.string().max(300),
  /** Everyday movement: from synced steps (default) or a fixed factor on BMR (DECISIONS #36). */
  activityMode: z.enum(activityModes),
  /** BMR × this when `activityMode` is "factor" (and the fallback when there are no steps). */
  activityFactor: z.number().min(1.1).max(2),
  /** Ride calories from kJ of work (default; kJ ≈ kcal for cycling) or the device's estimate. */
  exerciseSource: z.enum(exerciseSources),
  /** No deficit on race days and hard days (≥ 900 kcal of exercise). Off by default. */
  protectHardDays: z.boolean(),
  /** Pace for a weight goal with no target date, kg per week. */
  defaultKgPerWeek: z.number().min(0.1).max(1),
  proteinGPerKg: z.number().min(0.8).max(3.5),
  fatGPerKg: z.number().min(0.4).max(2),
});
/** Energy settings, patched — no defaults here (rule 1b); `core.energyDefaults` fills the gaps. */
export const energyPatchSchema = energyFields.partial().extend({
  unset: z.array(z.enum(['bmrKcal', 'bmrSource', 'bmrDate', 'bmrNote'])).optional(),
});
export type EnergyPatch = z.infer<typeof energyPatchSchema>;
export interface EnergySettings {
  bmrKcal?: number | undefined;
  bmrSource?: BmrSource | undefined;
  bmrDate?: IsoDate | undefined;
  bmrNote?: string | undefined;
  activityMode?: (typeof activityModes)[number] | undefined;
  activityFactor?: number | undefined;
  exerciseSource?: (typeof exerciseSources)[number] | undefined;
  protectHardDays?: boolean | undefined;
  defaultKgPerWeek?: number | undefined;
  proteinGPerKg?: number | undefined;
  fatGPerKg?: number | undefined;
  updatedAt?: string | undefined;
}

/** Where a day's calorie budget comes from (Food log "Energy today", Athlete "Calorie budget"). */
export interface BudgetLine {
  key: 'base' | 'activity' | 'exercise' | 'goal';
  label: string;
  kcal: number;
  /** "BMR 1,938 × 1.10", "11,933 steps", "planned" … */
  note: string;
}

export interface BudgetExercise {
  name: string;
  kcal: number;
  /** "kJ" | "device" | "planned" */
  basis: 'kJ' | 'device' | 'planned';
  /** Calendar session or intervals.icu activity. */
  ref: string;
  startLocal?: string | undefined;
}

export interface GoalPace {
  /** The weight goal driving the adjustment, if any. */
  goalId?: string | undefined;
  title?: string | undefined;
  targetKg?: number | undefined;
  targetDate?: IsoDate | undefined;
  trendKg?: number | undefined;
  /** Negative = losing. */
  kgPerWeek: number;
  /** Per day; negative = deficit. */
  kcalPerDay: number;
  mode: 'maintain' | 'lose' | 'gain' | 'reached';
  /** "No target date — 0.5 kg/week default", "Clamped to 1.0 kg/week" … */
  note?: string | undefined;
}

export interface MacroTargets {
  proteinG: number;
  fatG: number;
  carbsG: number;
}

/** One day's food, summed for the calendar grid. */
export interface DayFoodSummary {
  date: IsoDate;
  /** Null when nothing is logged. */
  eaten: { kcal: number; protein: number; carbs: number; fat: number } | null;
  /** kcal per meal slot, in the settings' slot order (only slots with entries). */
  slots: { name: string; kcal: number }[];
  /** The day's budget; null until RMR is set. Future days include planned sessions. */
  budget: number | null;
}

/** `GET /api/energy/days` — the calendar's food layer for a range of weeks. */
export interface DaysPayload {
  days: DayFoodSummary[];
  /** Trend weight at the end of each (Monday-start) week that has started. */
  weeks: { start: IsoDate; trendKg: number | null }[];
  /** Set when intervals.icu couldn't be read — budgets then miss exercise and steps. */
  warning?: string | undefined;
}

export interface EnergyBudget {
  date: IsoDate;
  /** False until BMR is set on the Athlete page. */
  ready: boolean;
  lines: BudgetLine[];
  total: number;
  exercise: BudgetExercise[];
  goal: GoalPace;
  hardDay: boolean;
  /** True when the goal adjustment was dropped for a hard day. */
  protectedDay: boolean;
  steps?: { today?: number | undefined; average?: number | undefined; used: number; basis: 'actual' | 'average' } | undefined;
  macros?: MacroTargets | undefined;
  /** intervals.icu couldn't be read — exercise and steps may be missing. */
  dataWarning?: string | undefined;
  /** What it was computed with — the Athlete page previews other days from these. */
  weightKg?: number | undefined;
  ftp?: number | undefined;
}

const bodyScanFields = z.object({
  date: isoDateSchema,
  weightKg: z.number().min(30).max(250),
  bodyFatPct: z.number().min(2).max(70),
  /** Lean soft tissue, as the scan reports it. */
  leanMassKg: z.number().min(10).max(200).optional(),
  boneMineralKg: z.number().min(0.5).max(10).optional(),
  /** Fat-free mass = lean + bone; computed from the others when left blank (`core.fatFreeMass`). */
  fatFreeMassKg: z.number().min(10).max(220).optional(),
  /** The scan's own resting-metabolic-rate estimate, if it printed one. */
  rmrKcal: z.number().int().min(500).max(5000).optional(),
  note: z.string().max(300).optional(),
});
export const bodyScanInputSchema = bodyScanFields;
export type BodyScanInput = z.infer<typeof bodyScanInputSchema>;
export const bodyScanPatchSchema = bodyScanFields.partial().extend({
  unset: z.array(z.enum(['leanMassKg', 'boneMineralKg', 'fatFreeMassKg', 'rmrKcal', 'note'])).optional(),
});
export type BodyScanPatch = z.infer<typeof bodyScanPatchSchema>;
export interface BodyScan extends BodyScanInput {
  id: string;
  createdAt: string;
}

export interface EnergyPayload {
  settings: EnergySettings;
  /** Newest first. */
  scans: BodyScan[];
}

// ── Staples (Canadian Nutrient File, USDA FoodData Central) ───────────────

export const stapleSources = ['cnf', 'usda'] as const;
export type StapleSource = (typeof stapleSources)[number];

export const stapleQuerySchema = z.object({ q: z.string().trim().min(2).max(80), source: z.enum(stapleSources).default('cnf') });

/** One search hit. Nutrients are per 100 g, as both sources publish them. */
export interface StapleResult {
  source: StapleSource;
  /** CNF food code / USDA fdcId. */
  ref: string;
  name: string;
  /** CNF food group / USDA data type. */
  group?: string | undefined;
  kcalPer100g: number;
}

/** A hit opened up: full nutrients per 100 g and the source's household portions in grams. */
export interface StapleDetail extends StapleResult {
  per100g: Nutrients;
  portions: { label: string; grams: number }[];
}

export interface StapleSearchPayload {
  source: StapleSource;
  results: StapleResult[];
  /** Set when the source couldn't be searched (USDA down, no key, CNF not imported). */
  unavailable?: string | undefined;
}

// ── Reading a label / screenshot (small vision model) ─────────────────────

const readValueSchema = z.object({
  value: z.number().nullable(),
  /** "low" when blurry, partly hidden, converted or inferred — highlighted amber for a check. */
  confidence: z.enum(['high', 'low']),
});

/**
 * What the small model reads off a photo, per ONE serving as printed. Strict-output friendly: no
 * optionals, and at most 16 nullable fields (an API limit) — the text fields are "" when absent.
 */
export const photoKinds = ['label', 'screenshot', 'other'] as const;
export type PhotoKind = (typeof photoKinds)[number];

export const nutritionReadingSchema = z.object({
  found: z.boolean().describe('False when the image shows no calorie or nutrition information.'),
  imageType: z.enum(photoKinds).describe('"label" for a nutrition facts table or packaging, "screenshot" for an app or website screen, else "other".'),
  name: z.string().describe('Short, specific name, e.g. "Greek yogurt, plain 0%" or "Caffè mocha, grande, 2% milk".'),
  brand: z.string().describe('Empty when no brand is visible.'),
  barcode: z.string().describe('Digits only, when a barcode number is legible; else empty.'),
  servingText: z.string().describe('The serving exactly as printed, e.g. "Per 3/4 cup (175 g)"; empty if none.'),
  servingMeasures: z
    .array(z.object({ amount: z.number(), unit: z.string() }))
    .describe('Everything one serving equals: "3/4 cup (175 g)" → [{0.75,"cup"},{175,"g"}]; "2 cookies (30 g)" → [{2,"cookie"},{30,"g"}]; a grande drink → [{1,"grande"}].'),
  nutrients: z.object({
    kcal: readValueSchema,
    fat: readValueSchema,
    satFat: readValueSchema,
    transFat: readValueSchema,
    carbs: readValueSchema,
    fibre: readValueSchema,
    sugars: readValueSchema,
    protein: readValueSchema,
    cholesterolMg: readValueSchema,
    sodiumMg: readValueSchema,
    potassiumMg: readValueSchema,
    calciumMg: readValueSchema,
    ironMg: readValueSchema,
  }),
  aliases: z.array(z.string()).describe('1–3 everyday names someone might say when logging it.'),
  note: z.string().describe('Anything worth knowing, e.g. "Values per 100 g; no serving size printed"; else empty.'),
});
export type NutritionReading = z.infer<typeof nutritionReadingSchema>;

/** Base64 images, already shrunk in the browser (~1600 px JPEG). Two at most: label + front/barcode. */
export const photoReadInputSchema = z.object({
  images: z
    .array(z.object({ mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(100).max(7_000_000) }))
    .min(1)
    .max(2),
});
export type PhotoReadInput = z.infer<typeof photoReadInputSchema>;

// ── Adjusting a food with AI ──────────────────────────────────────────────

/**
 * What the small model proposes when told how a food differs from its label ("no whipped cream").
 * Changes are deltas: `core.applyNutrientChanges` does the sums on whatever the form holds at the
 * time, and nothing happens until the user applies them.
 */
export const foodAdjustmentSchema = z.object({
  reply: z.string().describe('Two or three plain sentences: what was assumed and about how much it changes. Or one question, with no changes.'),
  changes: z
    .array(z.object({ nutrient: z.enum(nutrientKeys), delta: z.number().describe('Negative for less, positive for more. Never the new total.') }))
    .describe('Only the nutrients that move, per ONE serving; empty when asking a question or unable to estimate.'),
  name: z.string().describe('The name with the change in it, e.g. "Caffè mocha, grande, no whip"; empty when nothing changes.'),
  note: z.string().describe('One short line for the notes, e.g. "No whipped cream: about 80 kcal less (estimate)"; empty when nothing changes.'),
});
export type FoodAdjustment = z.infer<typeof foodAdjustmentSchema>;

export const foodAdjustInputSchema = z.object({
  /** The form as it stands, saved or not: the model works from these values, not the photo. */
  food: z.object({
    name: z.string().trim().max(200),
    brand: z.string().trim().max(200).optional(),
    servingLabel: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
    nutrients: nutrientsSchema.partial(),
  }),
  /** The conversation so far. It lives in the dialog and isn't stored. */
  turns: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(12),
  message: z.string().trim().min(2).max(500),
});
export type FoodAdjustInput = z.infer<typeof foodAdjustInputSchema>;

export interface PhotoReadResult {
  reading: NutritionReading;
  /** The photos as stored (S3), to attach to the food when it's saved. Empty when storage is off. */
  images: FoodImageRef[];
}

/** A barcode lookup: one of the user's foods, or an Open Food Facts product to review, or nothing. */
export interface BarcodeLookup {
  barcode: string;
  food?: Food | undefined;
  /** A prefilled food from Open Food Facts — always reviewed before it's saved. */
  openFoodFacts?: (FoodInput & { imageUrl?: string | undefined }) | undefined;
  /** Why Open Food Facts couldn't be asked (down, rate limited). */
  offError?: string | undefined;
}

// ── Log with words (small model parses; matching is checked against the user's foods) ──

/** What the small model returns for a phrase. Refs are catalog ids ("f12", "r3", "m1") — or null. */
export const phraseParseSchema = z.object({
  dayOffset: z.number().int().describe('Days relative to the day being viewed: 0 unless they said "yesterday" (−1) or similar.'),
  slot: z.string().nullable().describe('One of the meal names given, if the phrase says which meal; else null.'),
  time: z.string().nullable().describe('HH:MM (24 h) if a time was said; else null.'),
  items: z.array(
    z.object({
      heard: z.string().describe('The words for this item, as said.'),
      ref: z.string().nullable().describe('The catalog id it matches, or null when nothing in the catalog is this food.'),
      alternatives: z.array(z.string()).describe('Other catalog ids it could reasonably mean (at most 3).'),
      quantity: z.number().nullable().describe('Amount if one was said ("half" = 0.5, "a couple" = 2); else null.'),
      unit: z.string().nullable().describe("One of the item's listed units if a unit was said; else null."),
    }),
  ),
});
export type PhraseParse = z.infer<typeof phraseParseSchema>;

export interface WordsRef {
  kind: LoggableKind | 'meal';
  id: string;
  name: string;
}

/** One line of the confirm screen. Nothing is logged until the user confirms. */
export interface WordsItem {
  heard: string;
  /** Null: not in the user's foods — shown as "isn't in your foods yet", never guessed. */
  match: WordsRef | null;
  alternatives: WordsRef[];
  quantity: number;
  unit: string;
  /** Why this portion: "Your usual: 1 bagel (6 of 6 times)", "You said 2", "Default portion". */
  why: string;
}

export const wordsItemSchema = z.object({
  heard: z.string().max(200),
  match: z.object({ kind: z.enum(['food', 'recipe', 'meal']), id: z.string(), name: z.string() }).nullable(),
  quantity: z.number().positive().max(100_000),
  unit: foodUnitSchema,
});

export const foodParseInputSchema = z.object({
  phrase: z.string().trim().min(2).max(500),
  /** The day being viewed — "yesterday" is relative to it. */
  date: isoDateSchema,
  /** The slot to use when the phrase doesn't say. */
  slot: z.string().trim().min(1).max(30),
  /** The current items, when refining ("make it half a bagel"). */
  draft: z.array(wordsItemSchema).max(30).optional(),
});
export type FoodParseInput = z.infer<typeof foodParseInputSchema>;

export interface FoodParseResult {
  date: IsoDate;
  slot: string;
  time?: string | undefined;
  items: WordsItem[];
}
