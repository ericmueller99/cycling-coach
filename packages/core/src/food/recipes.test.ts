import type { Food, RecipeInput } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { loadRecipeClosure, recipesUsing, recipeTotals, wouldCycle, type RecipeSource } from './recipes';
import { recipeView } from './recipe-view';

const food = (id: string, kcalPer100g: number): Food => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  aliases: [],
  barcodes: [],
  source: 'label',
  measures: [{ unit: 'g', amount: 100 }],
  defaultPortion: { quantity: 100, unit: 'g' },
  nutrients: { kcal: kcalPer100g, fat: 0, carbs: 0, protein: 0 },
  images: [],
  createdAt: '',
  updatedAt: '',
});
const foods = new Map([food('flour', 360), food('water', 0), food('sauce', 50), food('cheese', 400)].map((f) => [f.id, f]));

// 500 g flour + 300 g water = 1800 kcal, 800 g, in 8 servings (100 g, 225 kcal each).
const dough = (over: Partial<RecipeSource & RecipeInput> = {}): RecipeSource & RecipeInput => ({
  id: 'dough',
  name: 'Pizza dough',
  aliases: [],
  servings: 8,
  finishedGrams: 800,
  ingredients: [
    { foodId: 'flour', quantity: 500, unit: 'g' },
    { foodId: 'water', quantity: 300, unit: 'g' },
  ],
  steps: ['Mix', 'Rest an hour'],
  ...over,
});
const pizza = (doughLine: { quantity: number; unit: string }, over: Partial<RecipeSource & RecipeInput> = {}): RecipeSource & RecipeInput => ({
  id: 'pizza',
  name: 'Pepperoni pizza',
  aliases: [],
  servings: 2,
  ingredients: [
    { recipeId: 'dough', ...doughLine },
    { foodId: 'sauce', quantity: 100, unit: 'g' },
    { foodId: 'cheese', quantity: 100, unit: 'g' },
  ],
  ...over,
});
const byId = (...rs: (RecipeSource & RecipeInput)[]) => new Map(rs.map((r) => [r.id, r]));

describe('recipes in recipes (DECISIONS #113)', () => {
  it('counts a base recipe by the serving', () => {
    const t = recipeTotals(pizza({ quantity: 2, unit: 'serving' }), foods, byId(dough()));
    expect(t.total.kcal).toBe(450 + 50 + 400);
    expect(t.perServing.kcal).toBe(450);
    expect(t.rawGrams).toBe(400);
    expect(t.problems).toEqual([]);
  });
  it('counts a base recipe by weight when it has a finished weight', () => {
    expect(recipeTotals(pizza({ quantity: 300, unit: 'g' }), foods, byId(dough())).total.kcal).toBe(675 + 450);
  });
  it('counts a base recipe by volume when it makes a volume', () => {
    const sauceBase = dough({ id: 'dough', finishedGrams: undefined, finishedVolume: { quantity: 4, unit: 'cup' } });
    expect(recipeTotals(pizza({ quantity: 1, unit: 'cup' }), foods, byId(sauceBase)).total.kcal).toBe(450 + 450);
  });
  it('reports a unit the base recipe has no measure for', () => {
    const t = recipeTotals(pizza({ quantity: 1, unit: 'cup' }), foods, byId(dough()));
    expect(t.problems).toEqual([{ recipeId: 'dough', reason: 'unit' }]);
    expect(t.total.kcal).toBe(450);
    expect(t.rawGrams).toBeUndefined();
  });
  it('reports a missing base recipe', () => {
    expect(recipeTotals(pizza({ quantity: 1, unit: 'serving' }), foods, new Map()).problems).toEqual([{ recipeId: 'dough', reason: 'missing' }]);
  });
  it('flags a base recipe with gaps of its own, and counts what it can', () => {
    const gappy = dough({ ingredients: [{ foodId: 'flour', quantity: 500, unit: 'g' }, { foodId: 'gone', quantity: 1, unit: 'g' }] });
    const t = recipeTotals(pizza({ quantity: 8, unit: 'serving' }), foods, byId(gappy));
    expect(t.problems).toEqual([{ recipeId: 'dough', reason: 'incomplete' }]);
    expect(t.total.kcal).toBe(1800 + 450);
  });
  it('follows the latest base recipe', () => {
    const richer = dough({ ingredients: [{ foodId: 'flour', quantity: 1000, unit: 'g' }] });
    expect(recipeTotals(pizza({ quantity: 2, unit: 'serving' }), foods, byId(richer)).total.kcal).toBe(900 + 450);
  });
  it('never counts a recipe inside itself', () => {
    const a: RecipeSource = { id: 'a', name: 'A', servings: 1, ingredients: [{ recipeId: 'b', quantity: 1, unit: 'serving' }] };
    const b: RecipeSource = { id: 'b', name: 'B', servings: 1, ingredients: [{ recipeId: 'a', quantity: 1, unit: 'serving' }, { foodId: 'flour', quantity: 100, unit: 'g' }] };
    const t = recipeTotals(a, foods, byId(a as never, b as never));
    expect(t.total.kcal).toBe(360);
    expect(t.problems).toEqual([{ recipeId: 'b', reason: 'incomplete' }]);
    const self: RecipeSource = { id: 's', name: 'S', servings: 1, ingredients: [{ recipeId: 's', quantity: 1, unit: 'serving' }] };
    expect(recipeTotals(self, foods, byId(self as never)).problems).toEqual([{ recipeId: 's', reason: 'cycle' }]);
  });
  it('stops below the deepest level', () => {
    const chain: RecipeSource[] = ['r0', 'r1', 'r2', 'r3', 'r4'].map((id, i, all) => ({
      id,
      name: id,
      servings: 1,
      ingredients: [i < all.length - 1 ? { recipeId: all[i + 1]!, quantity: 1, unit: 'serving' } : { foodId: 'flour', quantity: 100, unit: 'g' }],
    }));
    const map = new Map(chain.map((r) => [r.id, r]));
    expect(recipeTotals(chain[1]!, foods, map).total.kcal).toBe(360);
    const t = recipeTotals(chain[0]!, foods, map);
    expect(t.total.kcal).toBe(0);
    expect(t.problems).toEqual([{ recipeId: 'r1', reason: 'incomplete' }]);
  });
  it('shows the base recipe inside the view, with the share used', () => {
    const v = recipeView(pizza({ quantity: 2, unit: 'serving' }), foods, byId(dough()));
    expect(v.ingredients[0]).toMatchObject({ label: 'Pizza dough', quantity: 2, unit: 'serving', kcal: 450 });
    expect(v.ingredients[0]!.recipe).toMatchObject({ fraction: 0.25, view: { name: 'Pizza dough', servings: 8, steps: ['Mix', 'Rest an hour'] } });
    expect(v.ingredients[0]!.recipe!.view.ingredients.map((l) => l.label)).toEqual(['Flour', 'Water']);
    expect(v.perServing.kcal).toBe(450);
  });
  it('finds what to load, level by level', async () => {
    const all = byId(dough(), pizza({ quantity: 1, unit: 'serving' }));
    const calls: string[][] = [];
    const { recipesById, foodIds } = await loadRecipeClosure([pizza({ quantity: 1, unit: 'serving' })], async (ids) => {
      calls.push(ids);
      return ids.flatMap((id) => all.get(id) ?? []);
    });
    expect(calls).toEqual([['dough']]);
    expect([...recipesById.keys()]).toEqual(['dough']);
    expect(foodIds.sort()).toEqual(['cheese', 'flour', 'sauce', 'water']);
  });
  it('knows when a save would make a recipe contain itself', () => {
    const all = byId(dough(), pizza({ quantity: 1, unit: 'serving' }));
    expect(wouldCycle('dough', [{ recipeId: 'pizza', quantity: 1, unit: 'serving' }], all)).toBe(true);
    expect(wouldCycle('dough', [{ recipeId: 'dough', quantity: 1, unit: 'serving' }], all)).toBe(true);
    expect(wouldCycle('pizza', [{ recipeId: 'dough', quantity: 1, unit: 'serving' }], all)).toBe(false);
    expect([...recipesUsing('dough', [...all.values()])].sort()).toEqual(['dough', 'pizza']);
  });
});
