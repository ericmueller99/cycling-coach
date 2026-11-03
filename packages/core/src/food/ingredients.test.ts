import type { Food, IngredientLine, IngredientMatch, StapleDetail } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { draftToRecipeInput, perServingOf, priceLines, stapleCovers } from './ingredients';

const rice: Food = {
  id: 'rice',
  name: 'Rice, long grain, dry',
  aliases: [],
  barcodes: [],
  source: 'label',
  measures: [{ unit: 'g', amount: 50 }, { unit: 'cup', amount: 0.25 }],
  defaultPortion: { quantity: 0.25, unit: 'cup' },
  nutrients: { kcal: 180, fat: 0.5, carbs: 40, protein: 4 },
  images: [],
  createdAt: '',
  updatedAt: '',
};
const feta: StapleDetail = {
  source: 'cnf',
  ref: '33',
  name: 'Cheese, feta',
  kcalPer100g: 264,
  per100g: { kcal: 264, fat: 21, carbs: 4, protein: 14 },
  portions: [{ label: '250 ml crumbled', grams: 150 }],
};
const foods = new Map([[rice.id, rice]]);
type Line = IngredientLine & { match: IngredientMatch | null };
const line = (over: Partial<Line>): Line => ({ name: 'x', quantity: 100, unit: 'g', toTaste: false, match: null, ...over });

describe('stapleCovers', () => {
  it('needs every word heard in the staple name', () => {
    expect(stapleCovers('a banana', 'Banana, raw')).toBe(true);
    expect(stapleCovers('Feta cheese', 'Cheese, feta')).toBe(true);
    expect(stapleCovers('zorblax bar', 'Bars, granola')).toBe(false);
    expect(stapleCovers('the', 'Anything')).toBe(false);
  });
});

describe('priceLines', () => {
  it('prices foods and staples, skips to-taste lines, flags the rest', () => {
    const r = priceLines(
      [
        line({ name: 'Rice', quantity: 150, unit: 'g', match: { kind: 'food', foodId: 'rice', name: rice.name, source: 'label' } }),
        line({ name: 'Feta', quantity: 60, unit: 'g', match: { kind: 'staple', source: 'cnf', ref: '33', name: 'Cheese, feta', detail: feta } }),
        line({ name: 'Salt', quantity: 1, unit: 'tsp', toTaste: true }),
        line({ name: 'Mystery sauce', quantity: 50, unit: 'ml' }),
        line({ name: 'Rice', quantity: 2, unit: 'bagel', match: { kind: 'food', foodId: 'rice', name: rice.name, source: 'label' } }),
      ],
      foods,
    );
    // 150 g rice = 3 × 180; 60 g feta = 0.6 × 264.
    expect(r.ingredients.map((i) => i.kcal)).toEqual([540, 158, undefined, undefined, undefined]);
    expect(r.ingredients.map((i) => i.problem)).toEqual([undefined, undefined, undefined, 'unmatched', 'unit']);
    // 150 g rice = 3 × 4 g; 60 g feta = 0.6 × 14 g.
    expect(r.ingredients.map((i) => i.protein)).toEqual([12, 8.4, undefined, undefined, undefined]);
    expect(r.total.kcal).toBeCloseTo(698.4, 1);
    expect(r.unresolved).toBe(2);
    expect(r.staples).toEqual(['Cheese, feta']);
    expect(perServingOf(r.total, 2).kcal).toBeCloseTo(349.2, 1);
  });

  it('keeps offered matches only while a line is unmatched', () => {
    const suggestions = [{ kind: 'staple' as const, source: 'cnf' as const, ref: '33', name: 'Cheese, feta' }];
    const r = priceLines(
      [
        { ...line({ name: 'Feta' }), suggestions },
        { ...line({ name: 'Feta', quantity: 60, match: { kind: 'staple', source: 'cnf', ref: '33', name: 'Cheese, feta', detail: feta } }), suggestions },
      ],
      foods,
    );
    expect(r.ingredients[0]!.suggestions).toEqual(suggestions);
    expect(r.ingredients[1]!.suggestions).toBeUndefined();
  });

  it('prices a staple by its household measure', () => {
    const r = priceLines([line({ quantity: 0.5, unit: 'cup crumbled', match: { kind: 'staple', source: 'cnf', ref: '33', name: 'Feta', detail: feta } })], foods);
    // 1 cup crumbled = 150 g → ½ cup = 75 g = 198 kcal.
    expect(r.ingredients[0]!.kcal).toBe(198);
  });
});

describe('draftToRecipeInput', () => {
  it('maps matches to food ids, keeps the coach names as labels and to-taste lines apart', () => {
    const input = draftToRecipeInput(
      {
        name: 'Greek bowl',
        servings: 2,
        steps: ['Cook the rice.'],
        description: 'Thighs, rice, feta',
        minutes: 30,
        ingredients: [
          line({ name: 'Rice', quantity: 150, unit: 'grams', match: { kind: 'food', foodId: 'rice', name: rice.name, source: 'label' } }),
          line({ name: 'Feta', quantity: 60, match: { kind: 'staple', source: 'cnf', ref: '33', name: 'Feta', detail: feta } }),
          line({ name: 'Oregano', toTaste: true }),
        ],
      },
      (m) => (m.kind === 'food' ? m.foodId : 'saved-feta'),
    );
    expect(input.ingredients).toEqual([
      { foodId: 'rice', quantity: 150, unit: 'g', label: 'Rice' },
      { foodId: 'saved-feta', quantity: 60, unit: 'g', label: 'Feta' },
    ]);
    expect(input.notes).toBeUndefined();
    expect(input.description).toBe('Thighs, rice, feta');
    expect(input.minutes).toBe(30);
    expect(input.toTaste).toEqual(['Oregano']);
    expect(input.steps).toEqual(['Cook the rice.']);
  });
});
