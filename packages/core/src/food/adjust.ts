import type { NutrientKey, Nutrients } from '@cycling-coach/shared';
import { roundTo } from './units';

export interface NutrientChange {
  nutrient: NutrientKey;
  from: number;
  to: number;
}

/**
 * A proposed adjustment applied to the values as they stand. The model only says how much each
 * nutrient moves, so the sums happen here and a value edited since the proposal is kept. Nothing
 * goes below 0, and a nutrient with no value stays that way: a delta is no basis for a new number.
 */
export function applyNutrientChanges(
  nutrients: Partial<Nutrients>,
  changes: readonly { nutrient: NutrientKey; delta: number }[],
): { nutrients: Partial<Nutrients>; applied: NutrientChange[] } {
  const deltas = new Map<NutrientKey, number>();
  for (const c of changes) deltas.set(c.nutrient, (deltas.get(c.nutrient) ?? 0) + c.delta);
  const next = { ...nutrients };
  const applied: NutrientChange[] = [];
  for (const [nutrient, delta] of deltas) {
    const from = nutrients[nutrient];
    if (from == null) continue;
    const to = Math.max(0, roundTo(from + delta, nutrient === 'kcal' ? 0 : 1));
    if (to === from) continue;
    next[nutrient] = to;
    applied.push({ nutrient, from, to });
  }
  return { nutrients: next, applied };
}
