import type { Measure, Portion } from '@cycling-coach/shared';

/**
 * The portion maths (DECISIONS #33). A food's nutrients are for one reference serving; `measures`
 * say what that serving equals. Any mass measure unlocks every mass unit, any volume measure every
 * volume unit; label units ("bagel", "slice") only match themselves. `serving` always works.
 *
 * Volumes are Canadian metric: cup 250 ml, tbsp 15 ml, tsp 5 ml (what Canadian labels and recipes
 * use). A food's own cup measure ("3/4 cup (175 g)") always wins over the constant.
 */

export const MASS_UNITS = ['g', 'kg', 'oz', 'lb'] as const;
export const VOLUME_UNITS = ['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz'] as const;
export type MassUnit = (typeof MASS_UNITS)[number];
export type VolumeUnit = (typeof VOLUME_UNITS)[number];

const GRAMS: Record<MassUnit, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
const MILLILITRES: Record<VolumeUnit, number> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 250, fl_oz: 29.5735295625 };

const ALIASES: Record<string, string> = {
  g: 'g', gr: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  fl_oz: 'fl_oz', 'fl oz': 'fl_oz', 'fl. oz': 'fl_oz', floz: 'fl_oz', 'fluid ounce': 'fl_oz', 'fluid ounces': 'fl_oz',
  serving: 'serving', servings: 'serving', portion: 'serving',
};

export const isMassUnit = (u: string): u is MassUnit => (MASS_UNITS as readonly string[]).includes(u);
export const isVolumeUnit = (u: string): u is VolumeUnit => (VOLUME_UNITS as readonly string[]).includes(u);
export const isStandardUnit = (u: string) => u === 'serving' || isMassUnit(u) || isVolumeUnit(u);

/**
 * The stored spelling of a unit: standard units collapse to their short code ("Grams" → "g",
 * "tablespoons" → "tbsp"); a label unit is trimmed and lower-cased ("Bagel" → "bagel").
 */
export function canonicalUnit(raw: string): string {
  const u = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  return ALIASES[u] ?? u;
}

/** How units are compared: canonical, and "slices" matches "slice". */
export function unitKey(raw: string): string {
  const u = canonicalUnit(raw);
  if (isStandardUnit(u)) return u;
  // Singularise the last word: "slices" → "slice", "large eggs" → "large egg" (not "glass").
  return /[a-z]{3,}s$/.test(u) && !u.endsWith('ss') && !/\bs$/.test(u) ? u.slice(0, -1) : u;
}

interface HasMeasures {
  measures: readonly Measure[];
}

/** How many `unit` make up one reference serving, or null when the food can't be measured that way. */
export function amountPerServing(food: HasMeasures, unit: string): number | null {
  const key = unitKey(unit);
  if (key === 'serving') return 1;
  const exact = food.measures.find((m) => unitKey(m.unit) === key);
  if (exact) return exact.amount;
  if (isMassUnit(key)) {
    const mass = food.measures.find((m) => isMassUnit(unitKey(m.unit)));
    if (mass) return (mass.amount * GRAMS[unitKey(mass.unit) as MassUnit]) / GRAMS[key];
  }
  if (isVolumeUnit(key)) {
    const volume = food.measures.find((m) => isVolumeUnit(unitKey(m.unit)));
    if (volume) return (volume.amount * MILLILITRES[unitKey(volume.unit) as VolumeUnit]) / MILLILITRES[key];
  }
  return null;
}

/** Reference servings in a portion — e.g. 100 g of an "85 g" label is 1.176. Null if the unit doesn't fit. */
export function toServings(food: HasMeasures, quantity: number, unit: string): number | null {
  const per = amountPerServing(food, unit);
  return per ? quantity / per : null;
}

export const gramsPerServing = (food: HasMeasures) => amountPerServing(food, 'g');
export const mlPerServing = (food: HasMeasures) => amountPerServing(food, 'ml');

/** Weight of a portion, when the food has a mass measure. */
export function portionGrams(food: HasMeasures, quantity: number, unit: string): number | null {
  const servings = toServings(food, quantity, unit);
  const g = gramsPerServing(food);
  return servings != null && g != null ? servings * g : null;
}

/**
 * Units the portion picker offers, most useful first: the default unit, the food's own measures,
 * `serving`, then the rest of each family it has an anchor for.
 */
export function unitsFor(food: HasMeasures & { defaultPortion?: Portion | undefined }): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    const c = canonicalUnit(u);
    if (!out.some((x) => unitKey(x) === unitKey(c))) out.push(c);
  };
  if (food.defaultPortion) add(food.defaultPortion.unit);
  for (const m of food.measures) add(m.unit);
  add('serving');
  if (food.measures.some((m) => isMassUnit(unitKey(m.unit)))) for (const u of ['g', 'oz']) add(u);
  if (food.measures.some((m) => isVolumeUnit(unitKey(m.unit)))) for (const u of ['ml', 'cup', 'tbsp', 'tsp']) add(u);
  return out;
}

/**
 * Teach a food a new measure from something the user weighed: "1 cup = 120 g". `known` must already
 * resolve on the food. Replaces an existing measure of the same unit; returns null when `known`
 * doesn't fit the food.
 */
export function withMeasure(food: HasMeasures, added: Portion, known: Portion): Measure[] | null {
  const knownPer = amountPerServing(food, known.unit);
  if (!knownPer || known.quantity <= 0 || added.quantity <= 0) return null;
  const amount = (knownPer / known.quantity) * added.quantity;
  const unit = canonicalUnit(added.unit);
  return [...food.measures.filter((m) => unitKey(m.unit) !== unitKey(unit)), { unit, amount: roundTo(amount, 4) }];
}

/** Two measures with the same unit key make the maths ambiguous; returns the duplicated units. */
export function duplicateMeasureUnits(measures: readonly Measure[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const m of measures) {
    const k = unitKey(m.unit);
    if (seen.has(k)) dups.add(m.unit);
    seen.add(k);
  }
  return [...dups];
}

const FRACTIONS: [number, string][] = [
  [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔'],
];

/** "1.5" → "1½", "0.25" → "¼", 2.137 → "2.14". */
export function formatQuantity(q: number): string {
  const whole = Math.floor(q + 1e-9);
  const frac = q - whole;
  if (frac < 1e-6) return String(whole);
  const f = FRACTIONS.find(([v]) => Math.abs(frac - v) < 0.005);
  if (f) return `${whole > 0 ? whole : ''}${f[1]}`;
  return String(roundTo(q, 2));
}

const UNIT_LABELS: Record<string, [string, string]> = {
  fl_oz: ['fl oz', 'fl oz'],
  cup: ['cup', 'cups'],
  serving: ['serving', 'servings'],
};

/** "2 cups", "1½ bagels", "150 g". Label units get a naive plural. */
export function formatPortion(quantity: number, unit: string): string {
  const u = canonicalUnit(unit);
  const plural = quantity > 1 + 1e-9;
  let label: string;
  if (UNIT_LABELS[u]) label = UNIT_LABELS[u][plural ? 1 : 0];
  else if (isMassUnit(u) || isVolumeUnit(u)) label = u;
  else if (plural && /[a-z]$/.test(u) && !u.endsWith('s') && !u.includes('(')) label = /(ch|sh|x)$/.test(u) ? `${u}es` : `${u}s`;
  else label = u;
  return `${formatQuantity(quantity)} ${label}`;
}

export function roundTo(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
