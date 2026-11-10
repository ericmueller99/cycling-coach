import type {
  EstimateAdjustment,
  EstimateItem,
  EstimateItemReading,
  EstimateKind,
  EstimateQuestion,
  EstimateRange,
  EstimateReading,
  EstimateResult,
  EstimateSearch,
  FoodInput,
  FoodLogEntry,
  Nutrients,
} from '@cycling-coach/shared';
import { roundTo } from './units';

/**
 * Estimate (DECISIONS #94, #104). The model says what's in a meal and how sure it is; every sum happens
 * here, so the header is always the total of the cards. An estimate is the one thing in food logging
 * that's a guess, so nothing in it is allowed to look exact: kcal go to the nearest 5, and every item
 * keeps a range.
 */

export const MAX_ESTIMATE_QUESTIONS = 2;
const MAX_MODIFIERS = 3;
/** A range narrower than this claims more than a photo can show. */
const MIN_RANGE = 0.1;

export type EstimateConfidence = 'low' | 'medium' | 'high';

export const isEstimate = (e: Pick<FoodLogEntry, 'source'>): boolean => e.source === 'estimate';

/** A meal logged as N items is one estimate. */
export function countEstimates(entries: readonly Pick<FoodLogEntry, 'id' | 'source' | 'estimate'>[]): number {
  return new Set(entries.filter(isEstimate).map((e) => e.estimate?.group ?? e.id)).size;
}

const round5 = (n: number) => Math.round(n / 5) * 5;

export function estimateMultiplier(item: EstimateItem): number {
  const size = item.sizes[item.size]?.factor ?? 1;
  return item.mods.reduce((m, i) => m * (item.modifiers[i]?.factor ?? 1), item.qty * size * item.scale);
}

export interface EstimateTotals extends EstimateRange {
  nutrients: Nutrients;
}

/** Alcohol is only there when there's some, so an absent nutrient keeps meaning "not known". */
const withAlcohol = (n: Nutrients, alcohol: number): Nutrients => (alcohol > 0 ? { ...n, alcohol } : n);

/** The one place an item's numbers are worked out. Rounded here, so totals add up to what's shown. */
export function estimateItemTotals(item: EstimateItem): EstimateTotals {
  const m = estimateMultiplier(item);
  const kcal = round5(item.kcal * m);
  return {
    low: Math.min(round5(item.low * m), kcal),
    high: Math.max(round5(item.high * m), kcal),
    nutrients: withAlcohol(
      { kcal, protein: roundTo(item.protein * m, 1), carbs: roundTo(item.carbs * m, 1), fat: roundTo(item.fat * m, 1) },
      roundTo(item.alcohol * m, 1),
    ),
  };
}

export function estimateTotals(items: readonly EstimateItem[]): EstimateTotals {
  const sum = { kcal: 0, low: 0, high: 0, protein: 0, carbs: 0, fat: 0, alcohol: 0 };
  for (const item of items) {
    const t = estimateItemTotals(item);
    sum.kcal += t.nutrients.kcal;
    sum.low += t.low;
    sum.high += t.high;
    sum.protein += t.nutrients.protein;
    sum.carbs += t.nutrients.carbs;
    sum.fat += t.nutrients.fat;
    sum.alcohol += t.nutrients.alcohol ?? 0;
  }
  return {
    low: sum.low,
    high: sum.high,
    nutrients: withAlcohol(
      { kcal: sum.kcal, protein: roundTo(sum.protein, 1), carbs: roundTo(sum.carbs, 1), fat: roundTo(sum.fat, 1) },
      roundTo(sum.alcohol, 1),
    ),
  };
}

/** From the range rather than the model, so it moves when the rider changes something. */
export function estimateConfidence(kcal: number, range: EstimateRange): EstimateConfidence {
  if (kcal <= 0) return 'low';
  const width = (range.high - range.low) / kcal;
  // From real estimates: item ranges add up to a wide total, about 0.5 for a clear order and 0.6 for a vague one.
  if (width <= 0.3) return 'high';
  return width <= 0.55 ? 'medium' : 'low';
}

export function scaleRange(range: EstimateRange, factor: number): EstimateRange {
  return { low: roundTo(range.low * factor, 0), high: roundTo(range.high * factor, 0) };
}

const num = (n: number, max: number, fallback = 0) => (Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : fallback);
const text = (s: string, max: number) => s.trim().slice(0, max);

/** Sizes get normalised so the numbers as given are always the size that's selected. */
function tidySizes(sizes: EstimateItemReading['sizes']): { sizes: EstimateItem['sizes']; size: number } {
  const usable = sizes.filter((s) => text(s.label, 80) && Number.isFinite(s.factor) && s.factor > 0).slice(0, 8);
  if (usable.length < 2) return { sizes: [], size: -1 };
  let size = 0;
  usable.forEach((s, i) => {
    if (Math.abs(s.factor - 1) < Math.abs(usable[size]!.factor - 1)) size = i;
  });
  const base = usable[size]!.factor;
  return { sizes: usable.map((s) => ({ label: text(s.label, 80), factor: roundTo(s.factor / base, 3) })), size };
}

/**
 * A reading as an item, or null when there's nothing usable in it. Never trusts the model's limits.
 * A source survives only if it's one of the pages a search returned, so a link can't be made up.
 */
function tidyItem(r: EstimateItemReading, sources: ReadonlySet<string> = NO_SOURCES): EstimateItem | null {
  const name = text(r.name, 120);
  if (!name || !Number.isFinite(r.kcal)) return null;
  const kcal = num(r.kcal, 20_000);
  const { sizes, size } = tidySizes(r.sizes);
  return {
    name,
    why: text(r.why, 200),
    unit: sizes.length > 0 ? '' : text(r.unit, 30) || 'portion',
    quantity: r.quantity > 0 && r.quantity <= 1000 ? r.quantity : 1,
    kcal,
    low: Math.min(num(r.low, 20_000), kcal * (1 - MIN_RANGE)),
    high: Math.min(Math.max(num(r.high, 20_000, kcal), kcal * (1 + MIN_RANGE)), 20_000),
    protein: num(r.protein, 2_000),
    carbs: num(r.carbs, 2_000),
    fat: num(r.fat, 2_000),
    alcohol: num(r.alcohol, 2_000),
    sizes,
    modifiers: r.modifiers
      .filter((m) => text(m.label, 80) && Number.isFinite(m.factor) && m.factor >= 0)
      .slice(0, MAX_MODIFIERS)
      .map((m) => ({ label: text(m.label, 80), factor: Math.min(m.factor, 50) })),
    qty: 1,
    scale: 1,
    size,
    mods: [],
    assumed: '',
    ...(sources.has(r.source.trim()) ? { source: r.source.trim() } : {}),
  };
}

const NO_SOURCES: ReadonlySet<string> = new Set();

function tidyQuestion(q: EstimateQuestion, item: number): EstimateQuestion | null {
  const options = q.options
    .filter((o) => text(o.label, 80) && Number.isFinite(o.factor) && o.factor >= 0)
    .slice(0, 4)
    .map((o) => ({ ...o, label: text(o.label, 80), note: text(o.note, 200), factor: Math.min(o.factor, 50) }));
  if (!text(q.text, 200) || options.length < 2) return null;
  const typical = options[q.typical] ? q.typical : Math.max(0, options.findIndex((o) => o.factor === 1));
  return { item, text: text(q.text, 200), options, typical, assumed: text(q.assumed, 200) };
}

/** How the estimate was asked for, and the pages any search returned. */
export interface EstimateContext {
  kind: EstimateKind;
  search: EstimateSearch;
  sources?: readonly string[] | undefined;
}

/** What the model said, made safe to show. Questions follow their item, however many were dropped. */
export function estimateFromReading(r: EstimateReading, ctx: EstimateContext): EstimateResult {
  const sources = new Set((ctx.sources ?? []).filter((url) => /^https?:\/\/\S+$/i.test(url) && url.length <= 500));
  const items: EstimateItem[] = [];
  const moved = new Map<number, number>();
  r.items.forEach((reading, i) => {
    const item = tidyItem(reading, sources);
    if (!item) return;
    moved.set(i, items.length);
    items.push(item);
  });
  const questions: EstimateQuestion[] = [];
  for (const q of r.questions) {
    const item = moved.get(q.item);
    if (item == null || questions.some((x) => x.item === item) || questions.length >= MAX_ESTIMATE_QUESTIONS) continue;
    const tidy = tidyQuestion(q, item);
    if (tidy) questions.push(tidy);
  }
  // A search that found nothing usable says so, whatever the model claimed.
  const search: EstimateSearch = ctx.search === 'found' && !items.some((i) => i.source) ? 'none' : ctx.search;
  return {
    kind: ctx.kind,
    search,
    dish: text(r.dish, 120) || (items[0]?.name ?? ''),
    found: r.found
      .filter((f) => f.from !== 'web' || search === 'found')
      .filter((f) => ctx.kind === 'restaurant' || f.from !== 'menu')
      .map((f) => ({ from: f.from, text: text(f.text, 200) }))
      .filter((f) => f.text)
      .slice(0, 6),
    items,
    questions,
  };
}

/**
 * Answers to the questions, as an index per question and null for a skip. A skip takes the typical
 * amount and says so. Applied to the items as they came back, so answering twice can't stack. An
 * answer of 0 means they didn't have it. An answer that isn't about the amount, like how much butter,
 * moves the numbers and leaves the amount alone.
 */
export function applyEstimateAnswers(
  items: readonly EstimateItem[],
  questions: readonly EstimateQuestion[],
  answers: readonly (number | null)[],
): EstimateItem[] {
  const next = [...items];
  questions.forEach((q, i) => {
    const item = next[q.item];
    const answer = answers[i] ?? null;
    const option = q.options[answer ?? q.typical];
    if (!item || !option) return;
    const guessed = answer == null || option.unsure;
    const size = item.sizes.findIndex((s) => Math.abs(s.factor - option.factor) < 0.01);
    const current = item.sizes[item.size]?.factor ?? 1;
    const change = !option.amount ? { scale: option.factor } : size >= 0 ? { size, qty: 1 } : { qty: option.factor / current };
    next[q.item] = {
      ...item,
      why: guessed || !option.note ? item.why : option.note,
      assumed: guessed ? q.assumed : '',
      ...change,
    };
  });
  return next.filter((item) => item.qty > 0 && item.scale > 0);
}

/** How the stepper moves an item: whole ones for "2 pieces", quarters of a portion otherwise. */
export const estimateStep = (item: EstimateItem): number => (item.quantity >= 2 ? 1 : 0.25);

export const estimateAmount = (item: EstimateItem): number => roundTo(item.quantity * item.qty, 2);

/** The rider set the amount, so it's no longer an assumption. */
export function setEstimateAmount(item: EstimateItem, amount: number): EstimateItem {
  return { ...item, qty: Math.max(amount, estimateStep(item)) / item.quantity, assumed: '' };
}

/** "20 oz is about 260", worked out here so it can't go stale. Null when there's no other size. */
export function otherSizeHint(item: EstimateItem): string | null {
  const other = item.sizes[item.size + 1] ?? item.sizes[item.size - 1];
  if (!other) return null;
  const { nutrients } = estimateItemTotals({ ...item, size: item.sizes.indexOf(other) });
  return `${other.label} is about ${nutrients.kcal.toLocaleString('en-US')}`;
}

/** Spread a change across the base numbers, so it lands right at the item's current amount. */
function applyChange(item: EstimateItem, c: EstimateAdjustment['changes'][number]): EstimateItem {
  const m = estimateMultiplier(item) || 1;
  const add = (base: number, delta: number, max: number) => num(base + (Number.isFinite(delta) ? delta : 0) / m, max);
  const kcal = add(item.kcal, c.kcal, 20_000);
  return {
    ...item,
    kcal,
    low: Math.min(add(item.low, c.kcal, 20_000), kcal),
    high: Math.max(add(item.high, c.kcal, 20_000), kcal),
    protein: add(item.protein, c.protein, 2_000),
    carbs: add(item.carbs, c.carbs, 2_000),
    fat: add(item.fat, c.fat, 2_000),
    alcohol: add(item.alcohol, c.alcohol, 2_000),
    qty: Number.isFinite(c.factor) && c.factor > 0 ? Math.min(item.qty * c.factor, 100) : item.qty,
    why: text(c.why, 200) || item.why,
    assumed: '',
  };
}

/** "Anything different?". The sums happen on the items as they stand, so a change since is kept. */
export function applyEstimateAdjustment(items: readonly EstimateItem[], a: EstimateAdjustment): EstimateItem[] {
  const next = [...items];
  for (const c of a.changes) {
    const item = next[c.item];
    if (item) next[c.item] = applyChange(item, c);
  }
  const gone = new Set([...a.removed, ...a.changes.filter((c) => c.factor === 0).map((c) => c.item)]);
  const added = a.added.map((r) => tidyItem(r)).filter((i): i is EstimateItem => i != null);
  return [...next.filter((_, i) => !gone.has(i)), ...added].slice(0, 20);
}

/** One serving of the whole meal: search for it next time, with no AI, and it's still an estimate. */
export function estimateAsFood(name: string, items: readonly EstimateItem[], place?: string): FoodInput {
  const { low, high, nutrients } = estimateTotals(items);
  const notes = `Estimated${place ? ` at ${place}` : ''}: ${items.map((i) => i.name).join(', ')}`;
  return {
    name,
    aliases: [],
    barcodes: [],
    source: 'estimate',
    measures: [{ unit: 'serving', amount: 1 }],
    defaultPortion: { quantity: 1, unit: 'serving' },
    nutrients,
    notes: notes.slice(0, 500),
    images: [],
    estimate: { low, high },
  };
}
