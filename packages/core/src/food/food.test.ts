import type { Food, FoodUsage } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { isValidGtin, normalizeBarcode, sameBarcode } from './barcode';
import { fatFreeMass, katchMcArdle } from './energy';
import { scaleNutrients, sumNutrients } from './nutrients';
import { computePortion, foodAsLoggable, foodUsage, startingPortion, type UsageEntry } from './portions';
import { mealTotal, recipeTotals } from './recipes';
import { rankByText, rankByUse, rankStaples, textScore } from './search';

const food = (id: string, over: Partial<Food>): Food => ({
  id,
  name: id,
  aliases: [],
  barcodes: [],
  source: 'manual',
  measures: [{ unit: 'g', amount: 100 }],
  defaultPortion: { quantity: 1, unit: 'serving' },
  nutrients: { kcal: 100, fat: 1, carbs: 10, protein: 5 },
  images: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
});

const bagel = food('bagel', {
  name: 'Blueberry bagel',
  measures: [{ unit: 'g', amount: 95 }, { unit: 'bagel', amount: 1 }],
  defaultPortion: { quantity: 1, unit: 'bagel' },
  nutrients: { kcal: 260, fat: 1.5, carbs: 52, protein: 9, sodiumMg: 400 },
});
const butter = food('butter', {
  name: 'Butter, salted',
  measures: [{ unit: 'g', amount: 14 }, { unit: 'tbsp', amount: 1 }],
  nutrients: { kcal: 100, fat: 11.3, carbs: 0, protein: 0.1 },
});

describe('nutrients', () => {
  it('scales, keeping absent optional nutrients absent', () => {
    expect(scaleNutrients(bagel.nutrients, 0.5)).toEqual({ kcal: 130, fat: 0.75, carbs: 26, protein: 4.5, sodiumMg: 200 });
    expect(scaleNutrients(butter.nutrients, 2)).not.toHaveProperty('sodiumMg');
  });
  it('sums, with an optional nutrient present if any part has it', () => {
    expect(sumNutrients([bagel.nutrients, butter.nutrients])).toEqual({ kcal: 360, fat: 12.8, carbs: 52, protein: 9.1, sodiumMg: 400 });
  });
});

describe('computePortion', () => {
  it('half a bagel', () => {
    expect(computePortion(bagel, 0.5, 'bagel')).toEqual({ servings: 0.5, grams: 47.5, nutrients: { kcal: 130, fat: 0.75, carbs: 26, protein: 4.5, sodiumMg: 200 } });
  });
  it('a bagel by weight', () => {
    expect(computePortion(bagel, 190, 'g')!.nutrients.kcal).toBe(520);
  });
  it('null for a unit that does not fit', () => {
    expect(computePortion(bagel, 1, 'cup')).toBeNull();
  });
});

describe('foodUsage — usual portions', () => {
  const e = (date: string, quantity: number, unit = 'bagel', slot = 'Breakfast', refId = 'bagel'): UsageEntry => ({
    kind: 'food',
    refId,
    slot,
    quantity,
    unit,
    date,
    createdAt: `${date}T08:00:00Z`,
  });

  it('is the most common portion, with the count', () => {
    const usage = foodUsage([e('2026-10-01', 1), e('2026-10-02', 1), e('2026-10-03', 0.5), e('2026-10-04', 1)]);
    expect(usage['food:bagel']).toMatchObject({ count: 4, lastDate: '2026-10-04', usual: { quantity: 1, unit: 'bagel', times: 3, of: 4 } });
  });
  it('ties go to the most recent', () => {
    const usage = foodUsage([e('2026-10-01', 1), e('2026-10-02', 0.5)]);
    expect(usage['food:bagel']!.usual.quantity).toBe(0.5);
  });
  it('keeps a usual per slot', () => {
    const usage = foodUsage([e('2026-10-01', 1), e('2026-10-02', 1), e('2026-10-03', 0.5, 'bagel', 'Snacks')]);
    expect(usage['food:bagel']!.bySlot['Snacks']).toMatchObject({ quantity: 0.5, times: 1 });
    expect(startingPortion(bagel, usage['food:bagel'], 'Snacks')).toMatchObject({ quantity: 0.5, unit: 'bagel' });
    expect(startingPortion(bagel, usage['food:bagel'], 'Lunch')).toMatchObject({ quantity: 1, unit: 'bagel' });
    expect(startingPortion(bagel, undefined)).toEqual({ quantity: 1, unit: 'bagel' });
  });
  it('counts a meal once per logging', () => {
    const items = [
      { ...e('2026-10-01', 1), fromMealId: 'm1' },
      { ...e('2026-10-01', 1, 'tbsp', 'Breakfast', 'butter'), fromMealId: 'm1' },
    ];
    expect(foodUsage(items)['meal:m1']).toMatchObject({ count: 1, lastDate: '2026-10-01' });
  });
});

describe('recipes & meals', () => {
  const foods = new Map([
    ['bagel', bagel],
    ['butter', butter],
  ]);
  it('totals ingredients and divides by servings', () => {
    const t = recipeTotals(
      { servings: 2, ingredients: [{ foodId: 'bagel', quantity: 2, unit: 'bagel' }, { foodId: 'butter', quantity: 28, unit: 'g' }] },
      foods,
    );
    expect(t.total.kcal).toBe(720);
    expect(t.perServing.kcal).toBe(360);
    expect(t.rawGrams).toBe(218);
    expect(t.problems).toEqual([]);
  });
  it('reports what it could not count', () => {
    const t = recipeTotals(
      { servings: 1, ingredients: [{ foodId: 'gone', quantity: 1, unit: 'g' }, { foodId: 'bagel', quantity: 1, unit: 'cup' }] },
      foods,
    );
    expect(t.problems).toEqual([{ foodId: 'gone', reason: 'missing' }, { foodId: 'bagel', reason: 'unit' }]);
    expect(t.total.kcal).toBe(0);
    expect(t.rawGrams).toBeUndefined();
  });
  it('a meal at ×0.5', () => {
    const lookup = (_k: string, id: string) => {
      const f = foods.get(id);
      return f ? foodAsLoggable(f) : undefined;
    };
    const items = [{ kind: 'food' as const, refId: 'bagel', quantity: 1, unit: 'bagel' }, { kind: 'food' as const, refId: 'butter', quantity: 1, unit: 'tbsp' }];
    expect(mealTotal(items, lookup).kcal).toBe(360);
    expect(mealTotal(items, lookup, 0.5).kcal).toBe(180);
  });
});

describe('search', () => {
  it('matches every token by prefix, or one typo', () => {
    expect(textScore('bagel', 'Blueberry bagel')).toBeGreaterThan(0);
    expect(textScore('blue bag', 'Blueberry bagel')).toBeGreaterThan(0);
    expect(textScore('bagle', 'Blueberry bagel')).toBeGreaterThan(0);
    expect(textScore('bagel cheese', 'Blueberry bagel')).toBe(0);
    expect(textScore('cafe', 'Café au lait')).toBeGreaterThan(0);
  });
  it('ranks by text, then by use', () => {
    const plain = food('plain', { name: 'Plain bagel' });
    const usage: Record<string, FoodUsage> = {
      'food:plain': { count: 12, lastDate: '2026-10-31', usual: { quantity: 1, unit: 'bagel', times: 12, of: 12 }, bySlot: {} },
    };
    const ranked = rankByUse([bagel, plain, butter], 'bagel', (f) => usage[`food:${f.id}`], '2026-11-01');
    expect(ranked.map((f) => f.id)).toEqual(['plain', 'bagel']);
    expect(rankByUse([bagel, plain, butter], '', (f) => usage[`food:${f.id}`], '2026-11-01').map((f) => f.id)).toEqual(['plain']);
  });
  it('finds by alias', () => {
    const yog = food('yog', { name: 'Greek yogurt, plain 0%', aliases: ['skyr'] });
    expect(rankByUse([yog], 'skyr', () => undefined, '2026-11-01')).toHaveLength(1);
  });
  it('text ranking prefers short, exact names', () => {
    const items = [{ name: 'Egg noodles, enriched, cooked' }, { name: 'Egg, chicken, whole, raw' }, { name: 'Egg' }];
    expect(rankByText(items, 'egg')[0]!.name).toBe('Egg');
  });
});

describe('barcodes', () => {
  it('normalises UPC-A to EAN-13', () => {
    expect(normalizeBarcode('064200116473')).toBe('0064200116473');
    expect(normalizeBarcode('0064200116473')).toBe('0064200116473');
    expect(normalizeBarcode('00064200116473')).toBe('0064200116473');
    expect(normalizeBarcode('12345')).toBeNull();
    expect(sameBarcode('064200116473', '0064200116473')).toBe(true);
  });
  it('checks the GS1 check digit', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('036000291452')).toBe(true);
  });
});

describe('BMR', () => {
  it('Katch-McArdle from fat-free mass', () => {
    expect(katchMcArdle(72.6)).toBe(1938);
  });
  it('fat-free mass: as reported, lean + bone, or from body fat %', () => {
    expect(fatFreeMass({ weightKg: 85, bodyFatPct: 15, fatFreeMassKg: 72.6 })).toBe(72.6);
    expect(fatFreeMass({ weightKg: 85, bodyFatPct: 15, leanMassKg: 69.2, boneMineralKg: 3.4 })).toBe(72.6);
    expect(fatFreeMass({ weightKg: 85, bodyFatPct: 15 })).toBe(72.3);
  });
});

describe('rankStaples', () => {
  const item = (code: string, name: string, extra: Partial<{ group: string; portionLabels: string[]; alt: string }> = {}) => ({
    code,
    name,
    kcal: 100,
    portionLabels: extra.portionLabels ?? [],
    ...(extra.group ? { group: extra.group } : {}),
    ...(extra.alt ? { alt: extra.alt } : {}),
  });
  const items = [
    item('1', 'Egg Benedict', { group: 'Mixed Dishes' }),
    item('2', 'Egg substitute, powder'),
    item('3', 'Egg, chicken, dried, whole'),
    item('3b', 'Egg, duck, whole, fresh, raw', { portionLabels: ['1 egg'] }),
    item('4', 'Egg, chicken, whole, fresh or frozen, raw', { portionLabels: ['1 large egg', '125 ml', '1 small egg', '1 medium egg', '250 ml'] }),
    item('10', 'Emu, outside drum, raw'),
    item('5', 'Egg, chicken, whole, cooked, fried', { portionLabels: ['1 large egg'] }),
    item('6', 'Bagel, egg', { portionLabels: ['1 large'] }),
    item('7', 'Cereal, hot, oats (oatmeal)'),
    item('8', 'Banana, raw', { portionLabels: ['1 medium (18cm to 20cm long)'] }),
    item('9', 'Pepper, banana, raw'),
  ];
  const codes = (q: string) => rankStaples(items, q).map((i) => i.code);

  it('puts the raw whole food first for a one-word staple', () => {
    expect(codes('egg')[0]).toBe('4');
    expect(codes('banana')[0]).toBe('8');
  });
  it('finds a food through its household portion, but only with its own lead noun', () => {
    expect(codes('large egg').slice(0, 2)).toEqual(['4', '5']);
  });
  it('falls back to partial matches when words are missing from the names', () => {
    expect(codes('rolled oats')).toEqual(['7']);
  });
});
