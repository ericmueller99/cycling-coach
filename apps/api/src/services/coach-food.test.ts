import type { Food, FoodLibrary, IngredientMatch, MealIdea, StapleDetail } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { applyIdeaFix, matchLines, priceIdea, suggestMatches, type MatchDeps } from './coach-food';

const food = (id: string, over: Partial<Food>): Food => ({
  id,
  name: id,
  aliases: [],
  barcodes: [],
  source: 'label',
  measures: [{ unit: 'g', amount: 100 }],
  defaultPortion: { quantity: 100, unit: 'g' },
  nutrients: { kcal: 100, fat: 1, carbs: 10, protein: 5 },
  images: [],
  createdAt: '',
  updatedAt: '',
  ...over,
});
const library: FoodLibrary = {
  foods: [
    food('chicken', { name: 'Chicken thighs, boneless' }),
    food('egg', { name: 'Egg', measures: [{ unit: 'large egg', amount: 1 }], defaultPortion: { quantity: 1, unit: 'large egg' } }),
  ],
  recipes: [],
  meals: [],
  usage: {},
  settings: { slots: [{ name: 'Dinner', time: '18:30' }] },
};
const feta: StapleDetail = { source: 'cnf', ref: '33', name: 'Cheese, feta', kcalPer100g: 264, per100g: { kcal: 264, fat: 21, carbs: 4, protein: 14 }, portions: [] };

function deps(over: Partial<MatchDeps> = {}): MatchDeps {
  return {
    library,
    matchWithAi: async () => ({
      ok: true,
      value: {
        items: [
          { index: 0, ref: 'f1', alternatives: [], quantity: null, unit: null },
          { index: 1, ref: 'f2', alternatives: [], quantity: 2, unit: 'large egg' },
          { index: 2, ref: null, alternatives: [], quantity: null, unit: null },
          { index: 3, ref: 'r9', alternatives: [], quantity: null, unit: null },
        ],
      },
    }),
    searchStaples: async (q) => ({ source: 'cnf', results: q.includes('feta') ? [{ source: 'cnf', ref: '33', name: 'Cheese, feta', kcalPer100g: 264 }] : [{ source: 'cnf', ref: '1', name: 'Bars, granola', kcalPer100g: 450 }] }),
    stapleDetail: async () => feta,
    ...over,
  };
}

const lines = [
  { name: 'Chicken thighs', quantity: 300, unit: 'g', toTaste: false },
  { name: 'Eggs', quantity: 100, unit: 'g', toTaste: false },
  { name: 'Feta cheese', quantity: 60, unit: 'g', toTaste: false },
  { name: 'Zorblax sauce', quantity: 30, unit: 'ml', toTaste: false },
  { name: 'Salt', quantity: 1, unit: 'tsp', toTaste: true },
];

describe('matchLines', () => {
  it('uses checked ids, converts units only when needed, falls back to covering staples', async () => {
    const out = await matchLines(deps(), lines);
    expect(out[0]!.match).toEqual({ kind: 'food', foodId: 'chicken', name: 'Chicken thighs, boneless', source: 'label' });
    // 100 g can't be measured for a count-only egg; the model's 2 large eggs can.
    expect(out[1]).toMatchObject({ quantity: 2, unit: 'large egg', match: { kind: 'food', foodId: 'egg' } });
    expect(out[2]!.match).toMatchObject({ kind: 'staple', ref: '33', name: 'Cheese, feta' });
    // An id that isn't a food ("r9") and a staple that doesn't cover the words → nothing.
    expect(out[3]!.match).toBeNull();
    expect(out[4]!.match).toBeNull();
  });

  it('works without the model (staples only) and never sends to-taste lines', async () => {
    const ai = vi.fn();
    const out = await matchLines(deps({ matchWithAi: null }), lines);
    expect(ai).not.toHaveBeenCalled();
    expect(out[0]!.match).toBeNull();
    expect(out[2]!.match?.kind).toBe('staple');

    const seen: string[][] = [];
    await matchLines(deps({ matchWithAi: async (input) => (seen.push(input.items.map((i) => i.name)), { ok: false }) }), lines);
    expect(seen).toEqual([['Chicken thighs', 'Eggs', 'Feta cheese', 'Zorblax sauce']]);
  });
});

describe('suggestMatches', () => {
  const staples = (names: Record<string, string[]>): MatchDeps['searchStaples'] => async (q) => ({
    source: 'cnf',
    results: (names[q] ?? []).map((name, i) => ({ source: 'cnf' as const, ref: `${q}-${i}`, name, kcalPer100g: 100 })),
  });

  it('offers his foods first, then staples, at most 3', async () => {
    const lib = { ...library, foods: [...library.foods, food('thighs-bone', { name: 'Chicken thighs, bone-in' })] };
    const out = await suggestMatches({ library: lib, searchStaples: staples({ 'chicken thighs': ['Chicken, thigh, raw', 'Chicken, thigh, roasted'] }) }, 'Chicken thighs');
    expect(out.map((o) => `${o.kind}:${o.name}`)).toEqual(['food:Chicken thighs, boneless', 'food:Chicken thighs, bone-in', 'staple:Chicken, thigh, raw']);
  });

  it('falls back to single words, longest first, and skips archived foods', async () => {
    const lib = { ...library, foods: [food('old', { name: 'Potatoes, old', archived: true })] };
    const out = await suggestMatches({ library: lib, searchStaples: staples({ potatoes: ['Potato, flesh and skin, raw'] }) }, 'Baby potatoes');
    expect(out).toEqual([{ kind: 'staple', source: 'cnf', ref: 'potatoes-0', name: 'Potato, flesh and skin, raw' }]);
  });

  it('puts whole-word staple hits before prefix hits', async () => {
    const out = await suggestMatches({ library: { ...library, foods: [] }, searchStaples: staples({ salmon: ['Salmonberry, raw', 'Fish, salmon, coho, raw'] }) }, 'Salmon fillet');
    expect(out.map((o) => o.name)).toEqual(['Fish, salmon, coho, raw', 'Salmonberry, raw']);
  });

  it('offers a staple he already saved as that food', async () => {
    const lib = { ...library, foods: [food('feta-food', { name: 'Cheese, feta', source: 'cnf', sourceRef: 'feta-0' })] };
    const out = await suggestMatches({ library: lib, searchStaples: staples({ feta: ['Cheese, feta'] }) }, 'Feta');
    expect(out).toEqual([{ kind: 'food', foodId: 'feta-food', name: 'Cheese, feta', source: 'cnf' }]);
  });
});

describe('applyIdeaFix', () => {
  const salmon = food('salmon', { name: 'Salmon, Atlantic', nutrients: { kcal: 200, fat: 12, carbs: 0, protein: 20 } });
  const chicken = library.foods[0]!;
  const foods = new Map([chicken, salmon].map((f) => [f.id, f]));
  const chickenMatch: IngredientMatch = { kind: 'food', foodId: chicken.id, name: chicken.name, source: 'label' };
  const idea = (name: string, extra: MealIdea['ingredients']): MealIdea =>
    priceIdea(
      {
        tag: 't',
        name,
        description: 'd',
        minutes: 20,
        servings: 1,
        ingredients: [{ name: 'Chicken thighs', quantity: 200, unit: 'g', toTaste: false, match: chickenMatch }, ...extra],
      },
      foods,
    );
  const miss = { name: 'Salmon fillet', quantity: 150, unit: 'g', toTaste: false, match: null, suggestions: [{ kind: 'food' as const, foodId: 'salmon', name: 'Salmon, Atlantic', source: 'label' as const }] };
  const ideas = [idea('A', [miss]), idea('B', [{ ...miss, name: 'salmon  fillet' }]), idea('C', [])];
  const salmonMatch: IngredientMatch = { kind: 'food', foodId: 'salmon', name: 'Salmon, Atlantic', source: 'label' };

  it('fixes the same name across ideas and re-prices them', () => {
    expect(ideas[0]!.unpriced).toEqual(['Salmon fillet']);
    expect(ideas[0]!.perServing!.kcal).toBe(200);
    const out = applyIdeaFix(ideas, { idea: 0, ingredient: 1 }, salmonMatch, foods)!;
    // 200 g chicken (100 kcal/100 g) + 150 g salmon (200 kcal/100 g).
    expect(out.map((i) => i.perServing!.kcal)).toEqual([500, 500, 200]);
    expect(out.map((i) => i.unpriced)).toEqual([[], [], []]);
    expect(out[0]!.ingredients[1]).toMatchObject({ match: salmonMatch, kcal: 300, protein: 30 });
    expect(out[0]!.ingredients[1]!.suggestions).toBeUndefined();
    expect(out[2]).toBe(ideas[2]);
  });

  it('refuses a line that is matched or missing', () => {
    expect(applyIdeaFix(ideas, { idea: 0, ingredient: 0 }, salmonMatch, foods)).toBeNull();
    expect(applyIdeaFix(ideas, { idea: 3, ingredient: 0 }, salmonMatch, foods)).toBeNull();
  });
});
