import type { Food } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { draftRecipeView, recipeView, scaleLines, scaleQuantity } from './recipe-view';

const rice: Food = {
  id: 'rice',
  name: 'Rice, long grain, dry',
  aliases: [],
  barcodes: [],
  source: 'label',
  measures: [{ unit: 'g', amount: 50 }],
  defaultPortion: { quantity: 50, unit: 'g' },
  nutrients: { kcal: 180, fat: 0.5, carbs: 40, protein: 4 },
  images: [],
  createdAt: '',
  updatedAt: '',
};

describe('scaleQuantity', () => {
  it('rounds the way a cook measures', () => {
    expect(scaleQuantity(300, 'g', 1.5)).toBe(450);
    expect(scaleQuantity(140, 'g', 1.5)).toBe(210);
    expect(scaleQuantity(133, 'g', 1.5)).toBe(200); // 199.5 → 5s
    expect(scaleQuantity(15, 'ml', 1.5)).toBe(23); // 22.5 → whole
    expect(scaleQuantity(5, 'g', 1.5)).toBe(7.5);
    expect(scaleQuantity(1, 'tbsp', 1.5)).toBe(1.5);
    expect(scaleQuantity(1, 'tbsp', 1 / 3)).toBe(0.25);
    expect(scaleQuantity(2, 'egg', 1.5)).toBe(3);
    expect(scaleQuantity(1, 'clove', 1.5)).toBe(1.5);
    expect(scaleQuantity(0.5, 'kg', 1.5)).toBe(0.75);
  });
  it('leaves an unscaled amount exactly as written', () => {
    expect(scaleQuantity(133, 'g', 1)).toBe(133);
  });
  it('never scales an amount to zero', () => {
    expect(scaleQuantity(1, 'tsp', 0.1)).toBe(0.25);
    expect(scaleQuantity(2, 'g', 0.1)).toBe(0.5);
  });
});

describe('scaleLines', () => {
  it('scales every line from one serving count to another', () => {
    const lines = [{ label: 'Rice', quantity: 150, unit: 'g' }, { label: 'Egg', quantity: 2, unit: 'egg' }];
    expect(scaleLines(lines, 2, 3)).toEqual([{ label: 'Rice', quantity: 225, unit: 'g' }, { label: 'Egg', quantity: 3, unit: 'egg' }]);
  });
  it('ignores a bad serving count', () => {
    const lines = [{ quantity: 150, unit: 'g' }];
    expect(scaleLines(lines, 0, 3)).toEqual(lines);
  });
});

describe('recipeView', () => {
  it('uses labels where the recipe has them and counts what it can', () => {
    const v = recipeView(
      {
        name: 'Rice bowl',
        servings: 2,
        ingredients: [
          { foodId: 'rice', quantity: 150, unit: 'g', label: 'Rice' },
          { foodId: 'rice', quantity: 50, unit: 'g' },
          { foodId: 'gone', quantity: 10, unit: 'g' },
        ],
        steps: ['Cook the rice.'],
        toTaste: ['Salt'],
      },
      new Map([[rice.id, rice]]),
    );
    expect(v.ingredients.map((l) => l.label)).toEqual(['Rice', 'Rice, long grain, dry', 'Unknown ingredient']);
    expect(v.ingredients[0]!.kcal).toBe(540);
    expect(v.ingredients[2]!.kcal).toBeUndefined();
    expect(v.perServing.kcal).toBe(360);
    expect(v.uncounted).toBe(1);
    expect(v.toTaste).toEqual(['Salt']);
    expect(JSON.stringify(v)).not.toContain('rice"'); // no food ids on the view
  });
});

describe('draftRecipeView', () => {
  it('splits to-taste lines out of the ingredients', () => {
    const v = draftRecipeView({
      name: 'Bowl',
      servings: 1,
      ingredients: [
        { name: 'Rice', quantity: 75, unit: 'g', toTaste: false, match: null, kcal: 270 },
        { name: 'Salt', quantity: 1, unit: 'pinch', toTaste: true, match: null },
      ],
      steps: ['Cook.'],
      totals: { perServing: { kcal: 270, fat: 1, carbs: 60, protein: 6 }, unresolved: 0 },
    });
    expect(v.ingredients).toEqual([{ label: 'Rice', quantity: 75, unit: 'g', kcal: 270 }]);
    expect(v.toTaste).toEqual(['Salt']);
  });
});
