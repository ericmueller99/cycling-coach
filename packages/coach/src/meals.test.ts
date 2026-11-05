import type { MealIdeas, RecipeDraft } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { renderFoodLine } from './context';
import { runTool, type CoachFoodPort, type CoachPorts } from './tools';

const per = { kcal: 720, protein: 52, carbs: 78, fat: 20 };
const ideas: MealIdeas = {
  id: 'ideas1',
  threadId: 't',
  slot: 'Dinner',
  date: '2026-11-01',
  ideas: [
    { tag: 'Best fit', name: 'Greek chicken rice bowl', description: 'x', minutes: 30, servings: 2, ingredients: [], perServing: per, unpriced: ['Lemon-yogurt sauce'] },
  ],
  followUps: [],
  picked: [],
  createdAt: '',
};
const draft: RecipeDraft = {
  id: 'd1',
  threadId: 't',
  name: 'Greek chicken rice bowl',
  servings: 2,
  ingredients: [
    { name: 'Rice', quantity: 150, unit: 'g', toTaste: false, match: null, problem: 'unmatched' },
  ],
  steps: ['Cook'],
  logged: [],
  totals: { perServing: per, total: per, unresolved: 1, staples: ['Cheese, feta'] },
  createdAt: '',
};

function ports(food: CoachFoodPort | null): CoachPorts {
  return { food } as unknown as CoachPorts;
}
const ingredient = { name: 'Rice', quantity: 150, unit: 'g', toTaste: false };

describe('meal tools', () => {
  it('suggest_meals stores the ideas and tells the model the computed numbers', async () => {
    let seen: unknown;
    const out = await runTool(
      'suggest_meals',
      { slot: 'Dinner', date: '2026-11-01', ideas: [{ tag: 'Best fit', name: 'Bowl', description: 'x', minutes: 30, servings: 2, ingredients: [ingredient] }], follow_ups: ['More ideas'] },
      { toolUseId: 'tu1', today: '2026-11-01', ports: ports({ createMealIdeas: async (i) => ((seen = i), ideas), createRecipeDraft: async () => draft }) },
    );
    expect(seen).toMatchObject({ toolUseId: 'tu1', slot: 'Dinner', followUps: ['More ideas'] });
    expect(out.ui).toEqual({ type: 'meal_ideas', ideasId: 'ideas1' });
    expect(out.content).toContain('0. Greek chicken rice bowl — 720 kcal · P 52 g · C 78 g · F 20 g per serving (not counted: Lemon-yogurt sauce)');
  });

  it('build_recipe returns the draft card with staples and unresolved lines', async () => {
    const out = await runTool(
      'build_recipe',
      { ideas_id: 'ideas1', idea_index: 0, name: 'Bowl', servings: 2, ingredients: [ingredient], steps: ['Cook'] },
      { toolUseId: 'tu2', today: '2026-11-01', ports: ports({ createMealIdeas: async () => ideas, createRecipeDraft: async () => draft }) },
    );
    expect(out.ui).toEqual({ type: 'recipe_ref', draftId: 'd1' });
    expect(out.content).toContain('saved to their foods when they log or save): Cheese, feta');
    expect(out.content).toContain('not counted until they pick a food or remove it: Rice');
  });

  it('suggest_meals passes the Details preview and the kcal range through', async () => {
    let seen: unknown;
    const preview = { difficulty: 'Easy', equipment: ['pan'], leftovers: 'none (1 serving)', why: 'Carbs for the race.', steps: ['Cook rice.', 'Sear chicken.', 'Serve.'] };
    await runTool(
      'suggest_meals',
      { slot: 'Dinner', date: '2026-11-01', ideas: [{ tag: 'Best fit', name: 'Bowl', description: 'x', minutes: 30, servings: 1, ingredients: [ingredient], ...preview }], follow_ups: [], kcal_range: { min: 650, max: 800 } },
      { toolUseId: 'tu1', today: '2026-11-01', ports: ports({ createMealIdeas: async (i) => ((seen = i), ideas), createRecipeDraft: async () => draft }) },
    );
    expect(seen).toMatchObject({ kcalRange: { min: 650, max: 800 }, ideas: [preview] });
  });

  it('errors back to the model without the food module', async () => {
    const out = await runTool('build_recipe', { name: 'Bowl', servings: 1, ingredients: [ingredient], steps: ['Cook'] }, { toolUseId: 't', today: '2026-11-01', ports: ports(null) });
    expect(out.isError).toBe(true);
  });

  it('offer_food_log puts the athlete\'s words on the card, with no food module and nothing stored', async () => {
    const out = await runTool('offer_food_log', { phrase: 'two eggs and toast for lunch' }, { toolUseId: 't', today: '2026-11-01', ports: ports(null) });
    expect(out.isError).toBeUndefined();
    expect(out.ui).toEqual({ type: 'food_log_offer', phrase: 'two eggs and toast for lunch' });
    expect(out.content).toContain('Nothing is logged until they confirm it');
  });

  it('offer_food_log sends a phrase too short to parse back to the model', async () => {
    const out = await runTool('offer_food_log', { phrase: 'x' }, { toolUseId: 't', today: '2026-11-01', ports: ports(null) });
    expect(out.isError).toBe(true);
    expect(out.ui).toBeUndefined();
  });
});

describe('renderFoodLine', () => {
  it('gives eaten, left and the meal being planned', () => {
    expect(
      renderFoodLine({ date: '2026-11-01', slot: 'Dinner', chosen: true, eaten: { kcal: 1980, protein: 92, carbs: 230, fat: 60 }, budgetKcal: 2822, proteinTargetG: 150 }),
    ).toBe(
      'Food Sun Nov 1 (their food log): eaten 1,980 kcal · P 92 g · C 230 g · F 60 g; budget 2,822 kcal → 842 kcal left; protein target 150 g → 58 g left. The athlete is planning Dinner for Sun Nov 1 (picked in the app).',
    );
  });
  it('says when there is no budget', () => {
    expect(renderFoodLine({ date: '2026-11-01', slot: 'Lunch', chosen: false, eaten: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, budgetKcal: null })).toContain(
      'no calorie budget yet (RMR not set on the Athlete page). The meal for this time of day is Lunch.',
    );
  });
});
