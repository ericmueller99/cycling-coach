import type { NutrientKey, Nutrients, StapleDetail, StapleResult } from '@cycling-coach/shared';

/**
 * USDA FoodData Central — the staples fallback when the Canadian Nutrient File has nothing.
 * Only generic foods (Foundation + SR Legacy), never the Branded database: the user's
 * foods stay free of crowd-sourced junk. Read-only; only this module talks to USDA.
 */

const BASE = 'https://api.nal.usda.gov/fdc/v1';
/** Generic foods only. */
const DATA_TYPES = 'Foundation,SR Legacy';

/** FDC nutrient numbers → our keys. Foundation foods sometimes only carry Atwater energy (957/958). */
const NUMBERS: Record<string, NutrientKey> = {
  '208': 'kcal',
  '204': 'fat',
  '606': 'satFat',
  '605': 'transFat',
  '205': 'carbs',
  '291': 'fibre',
  '269': 'sugars',
  '203': 'protein',
  '601': 'cholesterolMg',
  '307': 'sodiumMg',
  '306': 'potassiumMg',
  '301': 'calciumMg',
  '303': 'ironMg',
};
const ATWATER = ['958', '957'];

export class UsdaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface SearchFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients?: { nutrientNumber?: string; value?: number }[];
}
interface DetailFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients?: { nutrient?: { number?: string }; amount?: number }[];
  foodPortions?: { amount?: number; gramWeight?: number; modifier?: string; portionDescription?: string; measureUnit?: { name?: string; abbreviation?: string } }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function toNutrients(pairs: [string | undefined, number | undefined][]): Nutrients {
  const out: Partial<Record<NutrientKey, number>> = {};
  const atwater: Record<string, number> = {};
  for (const [num, value] of pairs) {
    if (!num || value == null || !Number.isFinite(value)) continue;
    const key = NUMBERS[num];
    if (key && out[key] == null) out[key] = round2(value);
    if (ATWATER.includes(num)) atwater[num] = value;
  }
  if (out.kcal == null) {
    const a = ATWATER.map((n) => atwater[n]).find((v) => v != null);
    if (a != null) out.kcal = round2(a);
  }
  return { fat: 0, carbs: 0, protein: 0, kcal: 0, ...out } as Nutrients;
}

/** "1 large", "1 cup chopped", "1 cup (4.86 large eggs)" — what core's portion parser reads. */
export function portionLabel(p: NonNullable<DetailFood['foodPortions']>[number]): string | null {
  if (p.portionDescription && /^\d/.test(p.portionDescription)) return p.portionDescription.trim();
  const amount = p.amount ?? 1;
  const unit = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
  const label = [amount, unit, p.modifier ?? ''].join(' ').replace(/\s+/g, ' ').trim();
  return label === String(amount) ? null : label;
}

export class UsdaClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${BASE}${path}?${new URLSearchParams({ ...params, api_key: this.apiKey })}`;
    const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 429) throw new UsdaError('USDA rate limit reached — try again in a while.', 429);
    if (res.status === 403) throw new UsdaError('USDA rejected the API key (USDA_FDC_API_KEY).', 403);
    if (!res.ok) throw new UsdaError(`USDA FoodData Central answered ${res.status}.`, res.status);
    return (await res.json()) as T;
  }

  async search(query: string): Promise<StapleResult[]> {
    const data = await this.get<{ foods?: SearchFood[] }>('/foods/search', { query, dataType: DATA_TYPES, pageSize: '25' });
    return (data.foods ?? []).map((f) => ({
      source: 'usda' as const,
      ref: String(f.fdcId),
      name: f.description,
      group: f.dataType,
      kcalPer100g: toNutrients((f.foodNutrients ?? []).map((n) => [n.nutrientNumber, n.value])).kcal,
    }));
  }

  async food(fdcId: string): Promise<StapleDetail | null> {
    if (!/^\d+$/.test(fdcId)) return null;
    const f = await this.get<DetailFood>(`/food/${fdcId}`, {});
    const per100g = toNutrients((f.foodNutrients ?? []).map((n) => [n.nutrient?.number, n.amount]));
    const portions: StapleDetail['portions'] = [];
    for (const p of f.foodPortions ?? []) {
      const label = portionLabel(p);
      if (label && p.gramWeight && p.gramWeight > 0 && !portions.some((x) => x.label === label)) portions.push({ label, grams: round2(p.gramWeight) });
    }
    return { source: 'usda', ref: String(f.fdcId), name: f.description, group: f.dataType, kcalPer100g: per100g.kcal, per100g, portions };
  }
}
