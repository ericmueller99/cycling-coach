import type {
  Food,
  FoodSource,
  FoodUsage,
  IsoDate,
  LoggableKind,
  Measure,
  Nutrients,
  Portion,
  PortionHint,
  Recipe,
} from '@cycling-coach/shared';
import { scaleNutrients } from './nutrients';
import { canonicalUnit, portionGrams, roundTo, toServings, unitKey } from './units';

/** Anything that can be logged with a portion: a food, or a recipe by the serving (or by weight). */
export interface Loggable {
  kind: LoggableKind;
  id: string;
  name: string;
  brand?: string | undefined;
  source: FoodSource | 'recipe';
  measures: Measure[];
  defaultPortion: Portion;
  /** Per one reference serving. */
  nutrients: Nutrients;
  servingLabel?: string | undefined;
}

export const foodAsLoggable = (f: Food): Loggable => ({
  kind: 'food',
  id: f.id,
  name: f.name,
  brand: f.brand,
  source: f.source,
  measures: f.measures,
  defaultPortion: f.defaultPortion,
  nutrients: f.nutrients,
  servingLabel: f.servingLabel,
});

/** A recipe's reference serving is one serving; with a finished weight it can be logged in grams too. */
export const recipeAsLoggable = (r: Recipe): Loggable => ({
  kind: 'recipe',
  id: r.id,
  name: r.name,
  source: 'recipe',
  measures: [
    { unit: 'serving', amount: 1 },
    ...(r.finishedGrams ? [{ unit: 'g', amount: roundTo(r.finishedGrams / r.servings, 2) }] : []),
  ],
  defaultPortion: { quantity: 1, unit: 'serving' },
  nutrients: r.totals.perServing,
  servingLabel: r.finishedGrams ? `1 serving (${Math.round(r.finishedGrams / r.servings)} g)` : '1 serving',
});

export interface PortionResult {
  servings: number;
  grams?: number | undefined;
  nutrients: Nutrients;
}

/** The numbers for "1.5 bagels" — null when the unit doesn't fit the item. */
export function computePortion(item: Pick<Loggable, 'measures' | 'nutrients'>, quantity: number, unit: string): PortionResult | null {
  const servings = toServings(item, quantity, unit);
  if (servings == null || !Number.isFinite(servings)) return null;
  const grams = portionGrams(item, quantity, unit);
  return {
    servings: roundTo(servings, 4),
    ...(grams != null ? { grams: roundTo(grams, 1) } : {}),
    nutrients: scaleNutrients(item.nutrients, servings),
  };
}

export const usageKey = (kind: LoggableKind | 'meal', id: string) => `${kind}:${id}`;

export interface UsageEntry {
  kind: LoggableKind;
  refId: string;
  slot: string;
  quantity: number;
  unit: string;
  date: IsoDate;
  /** ISO timestamp — orders same-day entries. */
  createdAt: string;
  fromMealId?: string | undefined;
}

/** How many recent entries "usual" looks at. */
export const USUAL_WINDOW = 20;

/** The most common portion, ties to the most recent; with how often it was that. */
function modePortion(entries: readonly UsageEntry[]): PortionHint {
  const counts = new Map<string, { portion: Portion; times: number; first: number }>();
  entries.forEach((e, i) => {
    const key = `${Math.round(e.quantity * 1000)}|${unitKey(e.unit)}`;
    const hit = counts.get(key);
    if (hit) hit.times++;
    else counts.set(key, { portion: { quantity: e.quantity, unit: canonicalUnit(e.unit) }, times: 1, first: i });
  });
  const best = [...counts.values()].sort((a, b) => b.times - a.times || a.first - b.first)[0]!;
  return { ...best.portion, times: best.times, of: entries.length };
}

/**
 * Per food / recipe / meal: how often, when last, and the usual portion overall and per slot
 * ("Usually 1 bagel (6 of 6)"). Meals count once per logging, not once per item.
 */
export function foodUsage(entries: readonly UsageEntry[]): Record<string, FoodUsage> {
  const newestFirst = [...entries].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  const byRef = new Map<string, UsageEntry[]>();
  for (const e of newestFirst) {
    const k = usageKey(e.kind, e.refId);
    byRef.set(k, [...(byRef.get(k) ?? []), e]);
  }
  const out: Record<string, FoodUsage> = {};
  for (const [k, list] of byRef) {
    const recent = list.slice(0, USUAL_WINDOW);
    const slots = new Map<string, UsageEntry[]>();
    for (const e of recent) slots.set(e.slot, [...(slots.get(e.slot) ?? []), e]);
    out[k] = {
      count: list.length,
      lastDate: list[0]!.date,
      usual: modePortion(recent),
      bySlot: Object.fromEntries([...slots].map(([slot, es]) => [slot, modePortion(es)])),
    };
  }
  // Meals: one logging = the entries sharing a fromMealId on a date+slot.
  const mealLogs = new Map<string, { date: IsoDate; mealId: string }>();
  for (const e of newestFirst) {
    if (e.fromMealId) mealLogs.set(`${e.fromMealId}|${e.date}|${e.slot}`, { date: e.date, mealId: e.fromMealId });
  }
  for (const { date, mealId } of mealLogs.values()) {
    const k = usageKey('meal', mealId);
    const hit = out[k];
    if (hit) hit.count++;
    else out[k] = { count: 1, lastDate: date, usual: { quantity: 1, unit: 'serving', times: 1, of: 1 }, bySlot: {} };
  }
  return out;
}

/** The portion to start the picker at: the usual in this slot, the usual overall, or the default. */
export function startingPortion(item: Pick<Loggable, 'defaultPortion'>, usage: FoodUsage | undefined, slot?: string): Portion & { hint?: PortionHint } {
  const hint = (slot ? usage?.bySlot[slot] : undefined) ?? usage?.usual;
  return hint ? { quantity: hint.quantity, unit: hint.unit, hint } : { ...item.defaultPortion };
}

/**
 * The meal "now" belongs to: the timed slot nearest the time (within 2½ h), else Snacks (or the
 * nearest timed slot when there's no Snacks). Slots without a time (Workout fuel) are never guessed.
 */
export function slotForTime(slots: readonly { name: string; time?: string | undefined }[], hhmm: string): string {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const now = mins(hhmm);
  const timed = slots.filter((s): s is { name: string; time: string } => !!s.time).map((s) => ({ name: s.name, d: Math.abs(mins(s.time) - now) }));
  timed.sort((a, b) => a.d - b.d);
  const nearest = timed[0];
  if (nearest && nearest.d <= 150) return nearest.name;
  const snacks = slots.find((s) => /snack/i.test(s.name));
  return snacks?.name ?? nearest?.name ?? slots[0]?.name ?? 'Snacks';
}
