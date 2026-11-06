import { collections, ensureIndexes, type Collections } from '@cycling-coach/db';
import { DEFAULT_FOOD_SLOTS } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FoodService } from './food';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('food_intro_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await c.foodSettings.deleteMany({});
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const FIRST = new Date('2026-11-06T10:00:00Z');
const LATER = new Date('2026-11-07T10:00:00Z');
const slots = [{ name: 'Second breakfast' }];

describe('the food intro flag (DECISIONS #88)', () => {
  it('starts unseen and stays seen', async () => {
    const food = new FoodService(c, () => FIRST);
    expect((await food.library(U)).introSeen).toBe(false);
    await food.markIntroSeen(U);
    expect((await food.library(U)).introSeen).toBe(true);
  });

  it('is per user', async () => {
    const food = new FoodService(c, () => FIRST);
    await food.markIntroSeen(U);
    expect((await food.library('bbbbbbbbbbbbbbbbbbbbbbbb')).introSeen).toBe(false);
  });

  it('gives a new settings document the default slots', async () => {
    const food = new FoodService(c, () => FIRST);
    await food.markIntroSeen(U);
    expect((await food.library(U)).settings.slots).toEqual(DEFAULT_FOOD_SLOTS);
    expect((await c.foodSettings.findOne({ userId: U }))?.slots).toEqual(DEFAULT_FOOD_SLOTS);
  });

  it("doesn't touch slots the user has set", async () => {
    const food = new FoodService(c, () => FIRST);
    await food.saveSettings(U, { slots });
    await food.markIntroSeen(U);
    expect((await food.library(U)).settings.slots).toEqual(slots);
  });

  it('survives saving the slots', async () => {
    const food = new FoodService(c, () => FIRST);
    await food.markIntroSeen(U);
    await food.saveSettings(U, { slots });
    expect((await food.library(U)).introSeen).toBe(true);
  });

  it('keeps the first time when the intro is replayed', async () => {
    await new FoodService(c, () => FIRST).markIntroSeen(U);
    await new FoodService(c, () => LATER).markIntroSeen(U);
    expect((await c.foodSettings.findOne({ userId: U }))?.introSeenAt).toEqual(FIRST);
  });
});
