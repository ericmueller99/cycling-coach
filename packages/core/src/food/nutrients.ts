import { nutrientKeys, type Nutrients } from '@cycling-coach/shared';

export const ZERO_NUTRIENTS: Nutrients = { kcal: 0, fat: 0, carbs: 0, protein: 0 };

/**
 * Multiply every nutrient. Optional ones stay absent when absent — "no sodium on the label" isn't
 * "0 mg sodium". Stored to 2 decimals; the UI rounds for display.
 */
export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const out: Partial<Record<keyof Nutrients, number>> = {};
  for (const k of nutrientKeys) {
    const v = n[k];
    if (v != null) out[k] = Math.round(v * factor * 100) / 100;
  }
  return out as Nutrients;
}

/** Add up nutrients; an optional nutrient is present in the sum if any part has it. */
export function sumNutrients(parts: readonly Nutrients[]): Nutrients {
  const out: Partial<Record<keyof Nutrients, number>> = { kcal: 0, fat: 0, carbs: 0, protein: 0 };
  for (const p of parts) {
    for (const k of nutrientKeys) {
      const v = p[k];
      if (v != null) out[k] = (out[k] ?? 0) + v;
    }
  }
  for (const k of nutrientKeys) if (out[k] != null) out[k] = Math.round(out[k]! * 100) / 100;
  return out as Nutrients;
}

/** Share of energy from each macro (4/4/9 kcal per g). */
export function macroSplit(n: Nutrients): { protein: number; carbs: number; fat: number } {
  const p = n.protein * 4;
  const c = n.carbs * 4;
  const f = n.fat * 9;
  const total = p + c + f;
  if (!total) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: p / total, carbs: c / total, fat: f / total };
}
