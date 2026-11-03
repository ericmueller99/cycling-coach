import type { Nutrients, NutrientKey } from '@cycling-coach/shared';

/**
 * The Canadian Nutrient File 2026 (Health Canada, Open Government Licence – Canada). Only this
 * module reads it. It's a reference table imported once into `cnf_foods` (`pnpm food:import-cnf`)
 * and searched from there — never a per-search API call. The user's own foods still start empty: a
 * staple only becomes one of their foods when they save it (DECISIONS #33).
 */

const BASE = 'https://open.canada.ca/data/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109/resource';
export const CNF_FILES = {
  foodName: `${BASE}/e1ffee62-58cb-4e3e-b359-115c658388ad/download/food_name.csv`,
  nutrientAmount: `${BASE}/0ff718fc-1133-4154-80c5-3d619e6c63be/download/nutrient_amount.csv`,
  measureName: `${BASE}/104adbc9-f4cc-40b1-9aaa-08290648e24b/download/measure_name.csv`,
  measureWeight: `${BASE}/bb76d816-3ac0-4749-8c4b-f0dbfd0fac76/download/measure_weight_conversion.csv`,
  foodGroup: `${BASE}/adc5b26e-14ea-4697-b208-bbb311955c81/download/cnf_food_group.csv`,
} as const;
export type CnfFiles = Record<keyof typeof CNF_FILES, string>;

/** CNF nutrient codes → our nutrient keys (Canadian Nutrition Facts set). */
const NUTRIENT_CODES: Record<string, NutrientKey> = {
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
const KJ_CODE = '268';
/** Household measures; 3 = refuse and 9 = yield aren't portions. */
const USER_DEFINED_MEASURE = '6';

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF. Strips a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Rows as objects keyed by the header. */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

export interface CnfFood {
  code: string;
  name: string;
  nameFr?: string | undefined;
  /** "Alternate description" — extra search words. */
  alt?: string | undefined;
  group?: string | undefined;
  per100g: Nutrients;
  /** Household measures with their weight ("1 large egg" = 52.61 g). */
  portions: { label: string; grams: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The four CNF tables joined into one record per food. Foods with no energy value are dropped. */
export function buildCnfFoods(files: CnfFiles): CnfFood[] {
  const groups = new Map(csvRecords(files.foodGroup).map((g) => [g['CNF_Food_Group_Code']!, g['CNF_Food_Group_Description_EN']!]));
  const measureNames = new Map(csvRecords(files.measureName).map((m) => [m['Measure_Code']!, m['Measure_Description_and_Unit_EN']!]));

  const nutrients = new Map<string, Partial<Record<NutrientKey, number>> & { kj?: number }>();
  for (const n of csvRecords(files.nutrientAmount)) {
    const code = n['Nutrient_Code']!;
    const key = NUTRIENT_CODES[code];
    if (!key && code !== KJ_CODE) continue;
    const value = Number(n['Nutrient_Amount']);
    if (!Number.isFinite(value)) continue;
    const food = nutrients.get(n['Food_Code']!) ?? {};
    if (key) food[key] = round2(value);
    else food.kj = value;
    nutrients.set(n['Food_Code']!, food);
  }

  const portions = new Map<string, { label: string; grams: number }[]>();
  for (const m of csvRecords(files.measureWeight)) {
    if (m['Measure_Type_Code'] !== USER_DEFINED_MEASURE) continue;
    const label = measureNames.get(m['Measure_Code']!)?.trim();
    const grams = Number(m['Measure_Weight_Conversion']);
    if (!label || !(grams > 0)) continue;
    const list = portions.get(m['Food_Code']!) ?? [];
    if (!list.some((p) => p.label === label)) list.push({ label, grams: round2(grams) });
    portions.set(m['Food_Code']!, list);
  }

  const out: CnfFood[] = [];
  for (const f of csvRecords(files.foodName)) {
    const code = f['Food_Code']!;
    const n = nutrients.get(code);
    const kcal = n?.kcal ?? (n?.kj != null ? round2(n.kj / 4.184) : undefined);
    if (!n || kcal == null) continue;
    const { kj: _kj, ...rest } = n;
    out.push({
      code,
      name: f['Food_Description_EN']!.trim(),
      nameFr: f['Food_Description_FR']?.trim() || undefined,
      alt: f['Alternate_Description_EN']?.trim() || undefined,
      group: groups.get(f['CNF_Food_Group_Code']!) || undefined,
      per100g: { fat: 0, carbs: 0, protein: 0, ...rest, kcal } as Nutrients,
      portions: portions.get(code) ?? [],
    });
  }
  return out;
}

/** Download the CNF tables (about 24 MB, mostly nutrient amounts). */
export async function downloadCnf(fetchImpl: typeof fetch = fetch): Promise<CnfFiles> {
  const entries = await Promise.all(
    (Object.entries(CNF_FILES) as [keyof CnfFiles, string][]).map(async ([key, url]) => {
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'cycling-coach (personal food log)' } });
      if (!res.ok) throw new Error(`CNF download failed: ${key} → HTTP ${res.status}`);
      return [key, await res.text()] as const;
    }),
  );
  return Object.fromEntries(entries) as CnfFiles;
}
