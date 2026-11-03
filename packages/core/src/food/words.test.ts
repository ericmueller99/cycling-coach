import type { Food, FoodLibrary, Meal, PhraseParse } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { buildCatalog, resolveWords } from './words';

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
const meal: Meal = {
  id: 'meal1',
  name: 'Usual breakfast',
  aliases: [],
  slot: 'Breakfast',
  items: [{ kind: 'food', refId: 'bagel', quantity: 1, unit: 'bagel' }],
  total: { kcal: 260, fat: 1.5, carbs: 52, protein: 9 },
  createdAt: '',
  updatedAt: '',
};
const lib: FoodLibrary = {
  foods: [
    food('bagel', { name: 'Blueberry bagel', measures: [{ unit: 'g', amount: 95 }, { unit: 'bagel', amount: 1 }], defaultPortion: { quantity: 1, unit: 'bagel' } }),
    food('butter', { name: 'Butter', measures: [{ unit: 'g', amount: 14 }, { unit: 'tbsp', amount: 1 }], defaultPortion: { quantity: 1, unit: 'tbsp' } }),
    food('egg', { name: 'Egg, large', measures: [{ unit: 'g', amount: 100 }, { unit: 'large egg', amount: 1.9 }], defaultPortion: { quantity: 100, unit: 'g' } }),
    food('old', { name: 'Old thing', archived: true }),
  ],
  recipes: [],
  meals: [meal],
  usage: {
    'food:butter': { count: 9, lastDate: '2026-10-31', usual: { quantity: 1, unit: 'tbsp', times: 7, of: 9 }, bySlot: {} },
  },
  settings: { slots: [{ name: 'Breakfast' }, { name: 'Lunch' }, { name: 'Snacks' }] },
};

const parse = (over: Partial<PhraseParse>): PhraseParse => ({ dayOffset: 0, slot: null, time: null, items: [], ...over });

describe('buildCatalog', () => {
  it('lists active foods and meals with short ids', () => {
    const { lines, refs } = buildCatalog(lib);
    expect(lines.map((l) => l.id)).toEqual(['f1', 'f2', 'f3', 'm1']);
    expect(lines[0]).toMatchObject({ name: 'Blueberry bagel', usual: '1 bagel' });
    expect(lines[1]!.usual).toBe('1 tbsp');
    expect(refs.get('m1')).toEqual({ kind: 'meal', id: 'meal1', name: 'Usual breakfast' });
  });
});

describe('resolveWords', () => {
  const { refs } = buildCatalog(lib);
  const opts = { viewedDate: '2026-11-01', slot: 'Snacks' };

  it('fills the usual portion when no amount was said', () => {
    const r = resolveWords(parse({ slot: 'breakfast', items: [{ heard: 'butter', ref: 'f2', alternatives: [], quantity: null, unit: null }] }), refs, lib, opts);
    expect(r.slot).toBe('Breakfast');
    expect(r.items[0]).toMatchObject({ match: { id: 'butter' }, quantity: 1, unit: 'tbsp', why: 'Your usual: 1 tbsp (7 of 9)' });
  });

  it('keeps a said amount, in a counting unit when none was said', () => {
    const r = resolveWords(
      parse({
        items: [
          { heard: 'half a bagel', ref: 'f1', alternatives: [], quantity: 0.5, unit: null },
          { heard: 'two eggs', ref: 'f3', alternatives: [], quantity: 2, unit: null },
          { heard: '30 g of butter', ref: 'f2', alternatives: [], quantity: 30, unit: 'grams' },
        ],
      }),
      refs,
      lib,
      opts,
    );
    expect(r.items.map((i) => [i.quantity, i.unit])).toEqual([
      [0.5, 'bagel'],
      [2, 'large egg'],
      [30, 'g'],
    ]);
    expect(r.items[0]!.why).toBe('You said ½ bagel');
  });

  it('never guesses: unknown or archived refs are unmatched; bad units fall back', () => {
    const r = resolveWords(
      parse({
        items: [
          { heard: 'oat milk latte', ref: null, alternatives: [], quantity: null, unit: null },
          { heard: 'mystery', ref: 'f99', alternatives: ['f1', 'f42'], quantity: null, unit: null },
          { heard: 'a cup of bagel', ref: 'f1', alternatives: [], quantity: 1, unit: 'cup' },
        ],
      }),
      refs,
      lib,
      opts,
    );
    expect(r.items[0]!.match).toBeNull();
    expect(r.items[1]!.match).toBeNull();
    expect(r.items[1]!.alternatives.map((a) => a.id)).toEqual(['bagel']);
    expect(r.items[2]).toMatchObject({ quantity: 1, unit: 'bagel' });
  });

  it('meals, days and times', () => {
    const r = resolveWords(parse({ dayOffset: -1, time: '07:40', items: [{ heard: 'the usual breakfast', ref: 'm1', alternatives: [], quantity: null, unit: null }] }), refs, lib, opts);
    expect(r).toMatchObject({ date: '2026-10-31', time: '07:40', slot: 'Snacks' });
    expect(r.items[0]).toMatchObject({ match: { kind: 'meal' }, quantity: 1, unit: 'serving' });
    expect(resolveWords(parse({ dayOffset: -30, time: '25:99' }), refs, lib, opts)).toEqual({ date: '2026-10-25', slot: 'Snacks', items: [] });
  });
});
