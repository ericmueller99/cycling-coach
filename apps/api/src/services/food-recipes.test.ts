import { collections, ensureIndexes, type Collections } from '@cycling-coach/db';
import type { FoodInput, Recipe } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FoodService } from './food';
import { RecipeShareService } from './recipe-share';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('food_recipes_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.foodLog.deleteMany({}), c.foods.deleteMany({}), c.recipes.deleteMany({})]);
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-11-16T18:00:00Z');
const service = () => new FoodService(c, () => NOW);

const per100g = (name: string, kcal: number): FoodInput => ({
  name,
  aliases: [],
  barcodes: [],
  source: 'manual',
  measures: [{ unit: 'g', amount: 100 }],
  defaultPortion: { quantity: 100, unit: 'g' },
  nutrients: { kcal, fat: 0, carbs: 0, protein: 0 },
  images: [],
});

async function setUp() {
  const food = service();
  const flour = (await food.createFood(U, per100g('Flour', 360))) as { id: string };
  const cheese = (await food.createFood(U, per100g('Cheese', 400))) as { id: string };
  // 1800 kcal, 800 g, 8 servings.
  const dough = await food.createRecipe(U, {
    name: 'Pizza dough',
    aliases: [],
    servings: 8,
    finishedGrams: 800,
    ingredients: [{ foodId: flour.id, quantity: 500, unit: 'g' }],
    steps: ['Mix', 'Rest'],
  });
  const pizza = await food.createRecipe(U, {
    name: 'Pepperoni pizza',
    aliases: [],
    servings: 2,
    ingredients: [
      { recipeId: dough.id, quantity: 2, unit: 'serving' },
      { foodId: cheese.id, quantity: 100, unit: 'g' },
    ],
  });
  return { food, flour, dough, pizza };
}

describe('recipes in recipes (DECISIONS #113)', () => {
  it('prices a recipe through the recipe it uses, everywhere it is read', async () => {
    const { food, dough, pizza } = await setUp();
    expect(pizza.totals.total.kcal).toBe(450 + 400);
    const lib = await food.library(U);
    expect(lib.recipes.find((r) => r.id === pizza.id)!.totals.perServing.kcal).toBe(425);
    const [entry] = (await food.log(U, [{ date: '2026-11-16', slot: 'Dinner', kind: 'recipe', refId: pizza.id, quantity: 1, unit: 'serving', via: 'manual' }])) as { nutrients: { kcal: number } }[];
    expect(entry!.nutrients.kcal).toBe(425);
    const detail = await new RecipeShareService(c, 'https://coach.example.com').detail(U, pizza.id);
    expect(detail!.view.ingredients[0]).toMatchObject({ label: 'Pizza dough', kcal: 450, recipe: { fraction: 0.25, view: { name: 'Pizza dough', steps: ['Mix', 'Rest'] } } });
    expect(JSON.stringify(detail!.view)).not.toContain(dough.id);
  });

  it('follows edits to the base recipe', async () => {
    const { food, flour, dough, pizza } = await setUp();
    await food.updateRecipe(U, dough.id, { ingredients: [{ foodId: flour.id, quantity: 1000, unit: 'g' }] });
    const lib = await food.library(U);
    expect(lib.recipes.find((r) => r.id === pizza.id)!.totals.total.kcal).toBe(900 + 400);
  });

  it('still counts an archived base recipe', async () => {
    const { food, dough, pizza } = await setUp();
    await food.archiveRecipe(U, dough.id);
    const lib = await food.library(U);
    expect(lib.recipes.find((r) => r.id === pizza.id)!.totals.total.kcal).toBe(850);
  });

  it('refuses an edit that would make a recipe contain itself', async () => {
    const { food, flour, dough, pizza } = await setUp();
    const loop = await food.updateRecipe(U, dough.id, {
      ingredients: [
        { foodId: flour.id, quantity: 500, unit: 'g' },
        { recipeId: pizza.id, quantity: 1, unit: 'serving' },
      ],
    });
    expect(loop).toMatchObject({ status: 400 });
    expect(await food.updateRecipe(U, dough.id, { ingredients: [{ recipeId: dough.id, quantity: 1, unit: 'serving' }] })).toMatchObject({ status: 400 });
    const ok = (await food.updateRecipe(U, pizza.id, { servings: 4 })) as Recipe;
    expect(ok.totals.perServing.kcal).toBe(212.5);
  });
});
