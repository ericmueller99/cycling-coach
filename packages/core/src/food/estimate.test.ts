import type { EstimateItem, EstimateItemReading, EstimateQuestion, EstimateReading } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import {
  applyEstimateAdjustment,
  applyEstimateAnswers,
  countEstimates,
  estimateAmount,
  estimateAsFood,
  estimateConfidence,
  estimateFromReading,
  estimateItemTotals,
  estimateTotals,
  otherSizeHint,
  setEstimateAmount,
} from './estimate';
import { entryRef } from './portions';

const reading = (over: Partial<EstimateItemReading> = {}): EstimateItemReading => ({
  name: 'Mashed potatoes',
  why: 'From the photo',
  unit: 'side',
  quantity: 1,
  kcal: 340,
  low: 260,
  high: 440,
  protein: 6,
  carbs: 40,
  fat: 18,
  alcohol: 0,
  sizes: [],
  modifiers: [],
  ...over,
});

const steak = reading({
  name: 'Top sirloin',
  unit: '',
  kcal: 480,
  low: 430,
  high: 540,
  sizes: [
    { label: '6 oz', factor: 0.75 },
    { label: '8 oz', factor: 1 },
    { label: '10 oz', factor: 1.25 },
  ],
});

const question = (over: Partial<EstimateQuestion> = {}): EstimateQuestion => ({
  item: 0,
  text: 'How much did you eat?',
  options: [
    { label: 'All of it', factor: 1, amount: true, note: 'All of it, as you said', unsure: false },
    { label: 'About half', factor: 0.5, amount: true, note: 'About half, as you said', unsure: false },
    { label: 'Not sure', factor: 1, amount: true, note: '', unsure: true },
  ],
  typical: 0,
  assumed: 'A full side',
  ...over,
});

const parse = (over: Partial<EstimateReading> = {}) =>
  estimateFromReading({ dish: 'Sirloin dinner', found: [], items: [reading()], questions: [], ...over });

const item = (over: Partial<EstimateItemReading> = {}): EstimateItem => parse({ items: [reading(over)] }).items[0]!;

describe('estimateTotals', () => {
  it('makes the header the sum of the items, as they appear', () => {
    const items = [item({ kcal: 333, low: 250, high: 420 }), item({ kcal: 142, low: 100, high: 190 })];
    const total = estimateTotals(items);
    const parts = items.map(estimateItemTotals);
    expect(total.nutrients.kcal).toBe(parts[0]!.nutrients.kcal + parts[1]!.nutrients.kcal);
    expect(total.low).toBe(parts[0]!.low + parts[1]!.low);
    expect(total.high).toBe(parts[0]!.high + parts[1]!.high);
  });

  it('rounds kcal to the nearest 5, so nothing looks exact', () => {
    expect(estimateItemTotals(item({ kcal: 333 })).nutrients.kcal).toBe(335);
  });

  it('applies amount, size and modifiers together', () => {
    const base = parse({ items: [steak] }).items[0]!;
    const big = { ...base, size: 2, qty: 2, modifiers: [{ label: 'No butter', factor: 0.5 }], mods: [0] };
    expect(estimateItemTotals(big).nutrients.kcal).toBe(600);
  });

  it('only carries alcohol when there is some', () => {
    expect(estimateTotals([item()]).nutrients.alcohol).toBeUndefined();
    expect(estimateTotals([item({ alcohol: 14 })]).nutrients.alcohol).toBe(14);
  });
});

describe('estimateConfidence', () => {
  it('reads it off the width of the range', () => {
    expect(estimateConfidence(1000, { low: 920, high: 1080 })).toBe('high');
    expect(estimateConfidence(1400, { low: 1180, high: 1650 })).toBe('medium');
    expect(estimateConfidence(1460, { low: 1120, high: 1870 })).toBe('medium');
    expect(estimateConfidence(1490, { low: 1110, high: 2050 })).toBe('low');
    expect(estimateConfidence(0, { low: 0, high: 0 })).toBe('low');
  });
});

describe('estimateFromReading', () => {
  it('keeps a range on an item the model called exact', () => {
    const lager = item({ kcal: 210, low: 210, high: 210 });
    expect(lager.low).toBeLessThan(lager.kcal);
    expect(lager.high).toBeGreaterThan(lager.kcal);
  });

  it('puts a low or high on the right side of the kcal', () => {
    const odd = item({ kcal: 200, low: 400, high: 100 });
    expect(odd.low).toBeLessThan(200);
    expect(odd.high).toBeGreaterThan(200);
  });

  it('drops an unusable item and keeps questions on the right one', () => {
    const r = parse({ items: [reading({ name: ' ' }), reading({ name: 'Lager' })], questions: [question({ item: 1 })] });
    expect(r.items.map((i) => i.name)).toEqual(['Lager']);
    expect(r.questions[0]?.item).toBe(0);
  });

  it('allows two questions, one per item, and ignores a bad index', () => {
    const items = [reading(), reading({ name: 'Bread' }), reading({ name: 'Lager' })];
    const qs = [question({ item: 9 }), question({ item: 0 }), question({ item: 0 }), question({ item: 1 }), question({ item: 2 })];
    expect(parse({ items, questions: qs }).questions.map((q) => q.item)).toEqual([0, 1]);
  });

  it('falls back to the amount as given when the typical answer is out of range', () => {
    expect(parse({ questions: [question({ typical: 7 })] }).questions[0]?.typical).toBe(0);
  });

  it('selects the size the numbers describe, even when none is exactly 1', () => {
    const r = parse({ items: [reading({ sizes: [{ label: '16 oz', factor: 0.9 }, { label: '20 oz', factor: 1.2 }] })] }).items[0]!;
    expect(r.size).toBe(0);
    expect(r.sizes[0]?.factor).toBe(1);
    expect(estimateItemTotals(r).nutrients.kcal).toBe(340);
  });

  it('names the meal after the first item when the model gave no name', () => {
    expect(parse({ dish: '' }).dish).toBe('Mashed potatoes');
  });
});

describe('applyEstimateAnswers', () => {
  const r = parse({ questions: [question()] });

  it('uses the answer and its reason', () => {
    const [mash] = applyEstimateAnswers(r.items, r.questions, [1]);
    expect(mash?.qty).toBe(0.5);
    expect(mash?.why).toBe('About half, as you said');
    expect(mash?.assumed).toBe('');
  });

  it('takes the typical amount on a skip, and says so', () => {
    const [mash] = applyEstimateAnswers(r.items, r.questions, [null]);
    expect(mash?.qty).toBe(1);
    expect(mash?.why).toBe('From the photo');
    expect(mash?.assumed).toBe('A full side');
  });

  it('treats "Not sure" as an assumption too', () => {
    expect(applyEstimateAnswers(r.items, r.questions, [2])[0]?.assumed).toBe('A full side');
  });

  it('selects a matching size instead of changing the amount', () => {
    const s = parse({ items: [steak], questions: [question({ options: [{ label: '10 oz', factor: 1.25, amount: true, note: '', unsure: false }, { label: '8 oz', factor: 1, amount: true, note: '', unsure: false }] })] });
    const [out] = applyEstimateAnswers(s.items, s.questions, [0]);
    expect(out?.sizes[out.size]?.label).toBe('10 oz');
    expect(out?.qty).toBe(1);
  });

  it('removes an item they didn\'t have, without moving the next answer', () => {
    const s = parse({
      items: [reading(), reading({ name: 'Bread' })],
      questions: [
        question({ options: [{ label: 'No', factor: 0, amount: true, note: '', unsure: false }, { label: 'Yes', factor: 1, amount: true, note: '', unsure: false }] }),
        question({ item: 1 }),
      ],
    });
    const out = applyEstimateAnswers(s.items, s.questions, [0, 1]);
    expect(out.map((i) => [i.name, i.qty])).toEqual([['Bread', 0.5]]);
  });

  it('moves the numbers but not the amount for an answer about what\'s in it', () => {
    const s = parse({
      items: [reading({ name: 'Bread with butter', unit: 'piece', quantity: 2, kcal: 260, low: 190, high: 340 })],
      questions: [question({ options: [{ label: 'None', factor: 0.8, amount: false, note: 'No butter, as you said', unsure: false }, { label: 'A little', factor: 1, amount: false, note: '', unsure: false }] })],
    });
    const [bread] = applyEstimateAnswers(s.items, s.questions, [0]);
    expect(estimateAmount(bread!)).toBe(2);
    expect(estimateItemTotals(bread!).nutrients.kcal).toBe(210);
  });

  it('keeps that change when the amount moves after', () => {
    const s = parse({ questions: [question({ options: [{ label: 'Lots', factor: 2, amount: false, note: '', unsure: false }, { label: 'Some', factor: 1, amount: false, note: '', unsure: false }] })] });
    const [mash] = applyEstimateAnswers(s.items, s.questions, [0]);
    expect(estimateItemTotals(setEstimateAmount(mash!, 0.5)).nutrients.kcal).toBe(340);
  });

  it('doesn\'t stack when answered again from the same items', () => {
    applyEstimateAnswers(r.items, r.questions, [1]);
    expect(applyEstimateAnswers(r.items, r.questions, [1])[0]?.qty).toBe(0.5);
  });
});

describe('changing an item', () => {
  it('clears the assumption when the rider sets the amount', () => {
    const changed = setEstimateAmount({ ...item(), assumed: 'A full side' }, 0.75);
    expect(changed.qty).toBe(0.75);
    expect(changed.assumed).toBe('');
  });

  it('works in the item\'s own units', () => {
    expect(setEstimateAmount(item({ quantity: 2, unit: 'piece' }), 3).qty).toBe(1.5);
  });

  it('never steps down to nothing', () => {
    expect(setEstimateAmount(item(), 0).qty).toBe(0.25);
  });

  it('prices the other size for the hint', () => {
    expect(otherSizeHint(parse({ items: [steak] }).items[0]!)).toBe('10 oz is about 600');
    expect(otherSizeHint(item())).toBeNull();
  });
});

describe('applyEstimateAdjustment', () => {
  const change = { item: 0, factor: 1, kcal: 0, protein: 0, carbs: 0, fat: 0, alcohol: 0, why: '' };
  const none = { reply: '', changes: [], removed: [], added: [] };

  it('scales an item for "I only had half"', () => {
    const [out] = applyEstimateAdjustment([item()], { ...none, changes: [{ ...change, factor: 0.5, why: 'Only half' }] });
    expect(out?.qty).toBe(0.5);
    expect(out?.why).toBe('Only half');
  });

  it('lands a delta at the current amount', () => {
    const half = { ...item(), qty: 0.5 };
    const [out] = applyEstimateAdjustment([half], { ...none, changes: [{ ...change, kcal: -50 }] });
    expect(estimateItemTotals(out!).nutrients.kcal).toBe(120);
  });

  it('stops at zero', () => {
    const [out] = applyEstimateAdjustment([item()], { ...none, changes: [{ ...change, kcal: -9000, fat: -9000 }] });
    expect(out?.kcal).toBe(0);
    expect(out?.fat).toBe(0);
  });

  it('removes and adds, and ignores a bad index', () => {
    const items = [item(), item({ name: 'Bread' })];
    const out = applyEstimateAdjustment(items, { ...none, changes: [{ ...change, item: 9 }], removed: [0], added: [reading({ name: 'Cheesecake' })] });
    expect(out.map((i) => i.name)).toEqual(['Bread', 'Cheesecake']);
  });
});

describe('estimateAsFood', () => {
  it('is one serving of the whole meal, with its range, and stays an estimate', () => {
    const food = estimateAsFood('The Keg · Sirloin dinner', [item()], 'The Keg');
    expect(food.source).toBe('estimate');
    expect(food.measures).toEqual([{ unit: 'serving', amount: 1 }]);
    expect(food.nutrients.kcal).toBe(340);
    expect(food.estimate).toEqual({ low: 260, high: 440 });
    expect(food.notes).toContain('The Keg');
  });
});

describe('entries', () => {
  it('counts a meal logged as items as one estimate', () => {
    const e = (id: string, group?: string) => ({ id, source: 'estimate' as const, estimate: { low: 0, high: 0, group, items: [], images: [] } });
    expect(countEstimates([e('a', 'g'), e('b', 'g'), e('c'), { id: 'd', source: 'manual' as const, estimate: undefined }])).toBe(2);
  });

  it('has no ref for a calories entry', () => {
    expect(entryRef({ kind: 'calories', refId: undefined })).toBeNull();
    expect(entryRef({ kind: 'food', refId: 'f1' })).toEqual({ kind: 'food', refId: 'f1' });
  });
});
