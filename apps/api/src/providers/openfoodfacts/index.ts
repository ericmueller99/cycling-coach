import type { FoodInput, Measure, NutrientKey, Nutrients } from '@cycling-coach/shared';

/**
 * Open Food Facts — only for a barcode the user scans that isn't in their foods yet. One product lookup,
 * read-only, never searched or bulk-imported: the result pre-fills the food form and nothing is
 * saved until they have checked it (DECISIONS #33). Only this module talks to Open Food Facts.
 */

const BASE = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'brands',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'nutriments',
  'nutrition_data_per',
  'image_front_small_url',
].join(',');
/** OFF asks API users to identify their app. No personal details. */
const USER_AGENT = 'cycling-coach/0.1 (personal food log)';

export class OpenFoodFactsError extends Error {}

type Nutriments = Record<string, number | string | undefined>;
interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  nutriments?: Nutriments;
  image_front_small_url?: string;
}

/** OFF nutriment keys (grams unless noted) → ours, with the factor into our unit. */
const MAP: [NutrientKey, string, number][] = [
  ['fat', 'fat', 1],
  ['satFat', 'saturated-fat', 1],
  ['transFat', 'trans-fat', 1],
  ['carbs', 'carbohydrates', 1],
  ['fibre', 'fiber', 1],
  ['sugars', 'sugars', 1],
  ['protein', 'proteins', 1],
  ['cholesterolMg', 'cholesterol', 1000],
  ['sodiumMg', 'sodium', 1000],
  ['potassiumMg', 'potassium', 1000],
  ['calciumMg', 'calcium', 1000],
  ['ironMg', 'iron', 1000],
];

const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Nutrients for one basis (`_serving` or `_100g`), or null when energy is missing. */
function nutrientsFor(n: Nutriments, basis: '_serving' | '_100g'): Nutrients | null {
  const kcal = num(n[`energy-kcal${basis}`]) ?? (num(n[`energy${basis}`]) != null ? num(n[`energy${basis}`])! / 4.184 : undefined);
  if (kcal == null) return null;
  const out: Partial<Record<NutrientKey, number>> = { kcal: Math.round(kcal) };
  for (const [key, off, factor] of MAP) {
    const v = num(n[`${off}${basis}`]);
    if (v != null) out[key] = round2(v * factor);
  }
  return { fat: 0, carbs: 0, protein: 0, ...out } as Nutrients;
}

/**
 * A product as a food to review: per serving when OFF has per-serving values and a serving
 * weight, otherwise per 100 g.
 */
export function offToFood(p: OffProduct, barcode: string): (FoodInput & { imageUrl?: string | undefined }) | null {
  const n = p.nutriments ?? {};
  const name = (p.product_name_en || p.product_name || '').trim();
  const servingQty = num(p.serving_quantity);
  const servingUnit = (p.serving_quantity_unit || 'g').toLowerCase();
  const perServing = servingQty && servingQty > 0 ? nutrientsFor(n, '_serving') : null;
  const per100 = nutrientsFor(n, '_100g');
  if (!name || (!perServing && !per100)) return null;
  const unit = servingUnit === 'ml' ? 'ml' : 'g';
  const measures: Measure[] = perServing ? [{ unit, amount: servingQty! }] : [{ unit: 'g', amount: 100 }];
  return {
    name,
    ...(p.brands ? { brand: p.brands.split(',')[0]!.trim() } : {}),
    aliases: [],
    barcodes: [barcode],
    source: 'off',
    sourceRef: p.code ?? barcode,
    servingLabel: perServing ? (p.serving_size?.trim() || `${servingQty} ${unit}`) : '100 g',
    measures,
    defaultPortion: perServing ? { quantity: 1, unit: 'serving' } : { quantity: 100, unit: 'g' },
    nutrients: (perServing ?? per100)!,
    images: [],
    ...(p.image_front_small_url ? { imageUrl: p.image_front_small_url } : {}),
  };
}

export class OpenFoodFacts {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** The product for a barcode, or null when OFF doesn't know it (or knows it without nutrition). */
  async product(barcode: string): Promise<(FoodInput & { imageUrl?: string | undefined }) | null> {
    const res = await this.fetchImpl(`${BASE}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 404) return null;
    if (res.status === 429) throw new OpenFoodFactsError('Open Food Facts is rate limiting — try again in a minute.');
    if (!res.ok) throw new OpenFoodFactsError(`Open Food Facts answered ${res.status}.`);
    const body = (await res.json()) as { status?: number; product?: OffProduct };
    if (body.status === 0 || !body.product) return null;
    return offToFood(body.product, barcode);
  }
}
