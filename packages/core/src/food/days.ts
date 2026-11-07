import type { DayFoodSummary, FoodLogEntry, IsoDate } from '@cycling-coach/shared';
import { countEstimates } from './estimate';
import { roundTo } from './units';

/**
 * Per-day food totals for the calendar grid: eaten kcal and macros, and kcal per
 * slot in `slotOrder` (slots not in the settings come after, alphabetically). Days without entries
 * aren't returned.
 */
export function dayTotals(entries: readonly FoodLogEntry[], slotOrder: readonly string[]): Map<IsoDate, Pick<DayFoodSummary, 'eaten' | 'slots' | 'estimates'>> {
  const byDay = new Map<IsoDate, FoodLogEntry[]>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const rank = (name: string) => {
    const i = slotOrder.indexOf(name);
    return i < 0 ? slotOrder.length : i;
  };
  const out = new Map<IsoDate, Pick<DayFoodSummary, 'eaten' | 'slots' | 'estimates'>>();
  for (const [date, list] of byDay) {
    const eaten = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const slots = new Map<string, number>();
    for (const e of list) {
      eaten.kcal += e.nutrients.kcal;
      eaten.protein += e.nutrients.protein;
      eaten.carbs += e.nutrients.carbs;
      eaten.fat += e.nutrients.fat;
      slots.set(e.slot, (slots.get(e.slot) ?? 0) + e.nutrients.kcal);
    }
    out.set(date, {
      eaten: { kcal: Math.round(eaten.kcal), protein: roundTo(eaten.protein, 1), carbs: roundTo(eaten.carbs, 1), fat: roundTo(eaten.fat, 1) },
      slots: [...slots]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([name, kcal]) => ({ name, kcal: Math.round(kcal) })),
      estimates: countEstimates(list),
    });
  }
  return out;
}
