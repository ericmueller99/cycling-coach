import { estimateItemTotals } from '@cycling-coach/core';
import { collections, ensureIndexes, logUsageSince, type Collections } from '@cycling-coach/db';
import type { EstimateItem, EstimateLogInput, FoodLogEntry } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userImagePrefix } from '../providers/storage/s3';
import { FoodService } from './food';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('food_estimate_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.foodLog.deleteMany({}), c.foods.deleteMany({})]);
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-11-06T20:00:00Z');
const at = { date: '2026-11-06', slot: 'Dinner' };

const item = (over: Partial<EstimateItem> = {}): EstimateItem => ({
  name: 'Top sirloin',
  why: 'Menu says 8 oz',
  unit: 'portion',
  quantity: 1,
  kcal: 480,
  low: 430,
  high: 540,
  protein: 50,
  carbs: 0,
  fat: 30,
  alcohol: 0,
  sizes: [],
  modifiers: [],
  qty: 1,
  scale: 1,
  size: -1,
  mods: [],
  assumed: '',
  ...over,
});
const lager = item({ name: 'Lager', kcal: 210, low: 180, high: 260, protein: 2, carbs: 18, fat: 0, alcohol: 14 });

const photo = { mediaType: 'image/jpeg' as const, data: 'x'.repeat(200), kind: 'plate' as const };
const input = (over: Partial<EstimateLogInput> = {}): EstimateLogInput => ({ ...at, name: 'The Keg · Sirloin dinner', kind: 'restaurant', place: 'The Keg', items: [item(), lager], logAs: 'meal', images: [], ...over });

function store() {
  const keys = new Set<string>();
  return {
    keys,
    put: vi.fn(async (key: string) => void keys.add(key)),
    remove: vi.fn(async (key: string) => void keys.delete(key)),
    signedUrl: vi.fn(async (key: string) => `https://photos.example/${key}`),
  };
}

const service = (photos: ReturnType<typeof store> | null = null) => new FoodService(c, () => NOW, photos);
const isEntry = (r: object): r is FoodLogEntry => !('error' in r);

describe('a calories entry', () => {
  it('needs only kcal, and adds to the day like anything else', async () => {
    const entry = await service().logCalories(U, { ...at, nutrients: { kcal: 600 } });
    expect(entry).toMatchObject({ kind: 'calories', name: 'Calories', source: 'manual', quantity: 1, nutrients: { kcal: 600, protein: 0, carbs: 0, fat: 0 } });
    expect(entry.refId).toBeUndefined();
  });

  it('keeps a name and the macros it was given', async () => {
    const entry = await service().logCalories(U, { ...at, name: 'Birthday cake', nutrients: { kcal: 450, fat: 22, alcohol: 3 } });
    expect(entry).toMatchObject({ name: 'Birthday cake', nutrients: { kcal: 450, fat: 22, carbs: 0, alcohol: 3 } });
  });

  it('stays out of usual portions and search ranking', async () => {
    await service().logCalories(U, { ...at, nutrients: { kcal: 600 } });
    expect(await logUsageSince(c, U, '2026-01-01')).toEqual([]);
  });

  it('has its numbers changed, but no portion', async () => {
    const food = service();
    const entry = await food.logCalories(U, { ...at, nutrients: { kcal: 600 } });
    expect(await food.patchEntry(U, entry.id, { quantity: 2 })).toMatchObject({ status: 400 });
    expect(await food.editCalories(U, entry.id, { name: 'Lunch out', nutrients: { kcal: 700, protein: 30 } })).toMatchObject({ name: 'Lunch out', nutrients: { kcal: 700, protein: 30, fat: 0 } });
  });

  it('still moves to another slot', async () => {
    const food = service();
    const entry = await food.logCalories(U, { ...at, nutrients: { kcal: 600 } });
    expect(await food.patchEntry(U, entry.id, { slot: 'Lunch' })).toMatchObject({ slot: 'Lunch', nutrients: { kcal: 600 } });
  });

  it('copies with the same numbers', async () => {
    const food = service();
    const entry = await food.logCalories(U, { ...at, name: 'Cake', nutrients: { kcal: 450 } });
    expect(await food.copyEntry(U, entry.id, { date: '2026-11-07' })).toMatchObject({ date: '2026-11-07', kind: 'calories', name: 'Cake', nutrients: { kcal: 450 } });
  });

  it('is the only kind that route changes', async () => {
    const food = service();
    const made = await food.createFood(U, { name: 'Oats', aliases: [], barcodes: [], source: 'manual', measures: [{ unit: 'g', amount: 100 }], defaultPortion: { quantity: 100, unit: 'g' }, nutrients: { kcal: 380, fat: 7, carbs: 66, protein: 13 }, images: [] });
    const [entry] = (await food.log(U, [{ ...at, kind: 'food', refId: (made as { id: string }).id, quantity: 100, unit: 'g', via: 'manual' }])) as FoodLogEntry[];
    expect(await food.editCalories(U, entry!.id, { name: 'Renamed' })).toMatchObject({ status: 400 });
  });
});

describe('logging an estimate', () => {
  it('makes the entry the sum of its items, whatever the client thinks', async () => {
    const [entry] = await service().logEstimate(U, input());
    expect(entry).toMatchObject({ kind: 'calories', source: 'estimate', via: 'estimate', name: 'The Keg · Sirloin dinner' });
    expect(entry?.nutrients).toEqual({ kcal: 690, protein: 52, carbs: 18, fat: 30, alcohol: 14 });
    expect(entry?.estimate).toMatchObject({ low: 610, high: 800, place: 'The Keg' });
    expect(entry?.estimate?.items).toHaveLength(2);
  });

  it('keeps the kind and where each item\'s numbers were published', async () => {
    const source = 'https://www.example-grill.ca/nutrition';
    const [entry] = await service().logEstimate(U, input({ items: [item({ source }), lager] }));
    expect(entry?.estimate?.kind).toBe('restaurant');
    expect(entry?.estimate?.items.map((i) => i.source)).toEqual([source, undefined]);
  });

  it('logs a home-cooked meal with no place', async () => {
    const [entry] = await service().logEstimate(U, input({ kind: 'home', name: 'Lasagna', place: 'Somewhere' }));
    expect(entry?.estimate?.kind).toBe('home');
    expect(entry?.estimate?.place).toBeUndefined();
  });

  it('logs one entry per item when asked, as one estimate', async () => {
    const entries = await service().logEstimate(U, input({ logAs: 'items' }));
    expect(entries.map((e) => e.name)).toEqual(['Top sirloin', 'Lager']);
    expect(entries[0]?.nutrients.kcal).toBe(estimateItemTotals(item()).nutrients.kcal);
    expect(entries[0]?.estimate?.group).toBeTruthy();
    expect(entries[0]?.estimate?.group).toBe(entries[1]?.estimate?.group);
  });

  it('keeps the photos only now, under the user\'s own prefix', async () => {
    const photos = store();
    const [entry] = await service(photos).logEstimate(U, input({ images: [photo, { ...photo, kind: 'menu' }] }));
    expect(entry?.estimate?.images.map((i) => i.kind)).toEqual(['plate', 'menu']);
    expect(entry?.estimate?.images.every((i) => i.key.startsWith(userImagePrefix(U)))).toBe(true);
    expect(photos.keys.size).toBe(2);
  });

  it('logs without photos when there\'s no storage', async () => {
    const [entry] = await service().logEstimate(U, input({ images: [photo] }));
    expect(entry?.estimate?.images).toEqual([]);
  });

  it('logs anyway when a photo won\'t upload', async () => {
    const photos = store();
    photos.put.mockRejectedValueOnce(new Error('bucket down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [entry] = await service(photos).logEstimate(U, input({ images: [photo, photo] }));
    expect(entry?.estimate?.images).toHaveLength(1);
    warn.mockRestore();
  });

  it('leaves no photos behind when the entry can\'t be written', async () => {
    const photos = store();
    const insert = vi.spyOn(c.foodLog, 'insertMany').mockRejectedValueOnce(new Error('database down'));
    await expect(service(photos).logEstimate(U, input({ images: [photo] }))).rejects.toThrow('database down');
    expect(photos.keys.size).toBe(0);
    insert.mockRestore();
  });
});

describe('changing a logged estimate', () => {
  it('recomputes from the items and keeps everything else', async () => {
    const food = service(store());
    const [entry] = await food.logEstimate(U, input({ images: [photo] }));
    const r = await food.editCalories(U, entry!.id, { items: [item({ qty: 0.5 }), lager] });
    expect(isEntry(r) && r.nutrients.kcal).toBe(450);
    expect(isEntry(r) && r.estimate).toMatchObject({ low: 395, high: 530, place: 'The Keg' });
    expect(isEntry(r) && r.estimate?.images).toHaveLength(1);
    expect(isEntry(r) && r.source).toBe('estimate');
  });

  it('won\'t take numbers that would stop matching the items', async () => {
    const food = service();
    const [entry] = await food.logEstimate(U, input());
    expect(await food.editCalories(U, entry!.id, { nutrients: { kcal: 100 } })).toMatchObject({ status: 400 });
  });

  it('won\'t scale it through the portion route', async () => {
    const food = service();
    const [entry] = await food.logEstimate(U, input());
    expect(await food.patchEntry(U, entry!.id, { quantity: 2 })).toMatchObject({ status: 400 });
  });

  it('copies it on its own, without the photos', async () => {
    const photos = store();
    const food = service(photos);
    const [entry] = await food.logEstimate(U, input({ logAs: 'items', images: [photo] }));
    const copy = await food.copyEntry(U, entry!.id, { date: '2026-11-07' });
    expect(isEntry(copy) && copy.estimate?.images).toEqual([]);
    expect(isEntry(copy) && copy.estimate?.group).toBeUndefined();
    expect(isEntry(copy) && copy.source).toBe('estimate');
  });
});

describe('an estimate\'s photos', () => {
  it('go with the entry', async () => {
    const photos = store();
    const food = service(photos);
    const [entry] = await food.logEstimate(U, input({ images: [photo] }));
    await food.deleteEntry(U, entry!.id);
    expect(photos.keys.size).toBe(0);
  });

  it('stay until the last item of a meal is gone', async () => {
    const photos = store();
    const food = service(photos);
    const [first, second] = await food.logEstimate(U, input({ logAs: 'items', images: [photo] }));
    await food.deleteEntry(U, first!.id);
    expect(photos.keys.size).toBe(1);
    await food.deleteEntry(U, second!.id);
    expect(photos.keys.size).toBe(0);
  });

  it('stay when the delete finds nothing', async () => {
    const photos = store();
    const food = service(photos);
    await food.logEstimate(U, input({ images: [photo] }));
    expect(await food.deleteEntry(U, 'bbbbbbbbbbbbbbbbbbbbbbbb')).toBe(false);
    expect(photos.keys.size).toBe(1);
  });

  it('are linked for their owner alone', async () => {
    const food = service(store());
    const [entry] = await food.logEstimate(U, input({ images: [photo] }));
    expect(await food.entryPhotos(U, entry!.id)).toEqual([{ kind: 'plate', url: expect.stringContaining('https://photos.example/') }]);
    expect(await food.entryPhotos('cccccccccccccccccccccccc', entry!.id)).toMatchObject({ status: 404 });
  });
});

describe('a saved estimate', () => {
  const saved = async (food: FoodService) => {
    await food.logEstimate(U, input({ saveAs: 'The Keg · Sirloin dinner' }));
    return (await food.library(U)).foods[0]!;
  };

  it('is one serving of the meal, with no photos', async () => {
    const food = await saved(service(store()));
    expect(food).toMatchObject({ name: 'The Keg · Sirloin dinner', source: 'estimate', nutrients: { kcal: 690 }, estimate: { low: 610, high: 800 }, images: [] });
  });

  it('says so on the entry', async () => {
    const [entry] = await service().logEstimate(U, input({ saveAs: 'The Keg · Sirloin dinner' }));
    expect(entry?.estimate?.savedAs).toBe('The Keg · Sirloin dinner');
  });

  it('stays an estimate when it\'s logged again, with its range scaled', async () => {
    const svc = service();
    const food = await saved(svc);
    const r = await svc.log(U, [{ ...at, kind: 'food', refId: food.id, quantity: 2, unit: 'serving', via: 'manual' }]);
    const entry = (r as FoodLogEntry[])[0]!;
    expect(entry).toMatchObject({ kind: 'food', source: 'estimate', nutrients: { kcal: 1380 } });
    expect(entry.estimate).toEqual({ low: 1220, high: 1600, items: [], images: [] });
  });

  it('moves its range with the portion', async () => {
    const svc = service();
    const food = await saved(svc);
    const [entry] = (await svc.log(U, [{ ...at, kind: 'food', refId: food.id, quantity: 1, unit: 'serving', via: 'manual' }])) as FoodLogEntry[];
    const r = await svc.patchEntry(U, entry!.id, { quantity: 0.5 });
    expect(isEntry(r) && r.estimate).toMatchObject({ low: 305, high: 400 });
  });

  it('keeps its range in step when the food is edited', async () => {
    const svc = service();
    const food = await saved(svc);
    const r = await svc.updateFood(U, food.id, { nutrients: { ...food.nutrients, kcal: 345 } });
    expect('estimate' in r && r.estimate).toEqual({ low: 305, high: 400 });
  });

  it('updates the one that\'s there, not a second copy', async () => {
    const svc = service();
    await saved(svc);
    await svc.logEstimate(U, input({ items: [item()], saveAs: 'the keg · sirloin dinner' }));
    const { foods } = await svc.library(U);
    expect(foods).toHaveLength(1);
    expect(foods[0]?.nutrients.kcal).toBe(480);
  });

  it('never overwrites a food of theirs with the same name', async () => {
    const svc = service();
    await svc.createFood(U, { name: 'Sirloin dinner', aliases: [], barcodes: [], source: 'label', measures: [{ unit: 'serving', amount: 1 }], defaultPortion: { quantity: 1, unit: 'serving' }, nutrients: { kcal: 500, fat: 20, carbs: 10, protein: 60 }, images: [] });
    await svc.logEstimate(U, input({ saveAs: 'Sirloin dinner' }));
    const { foods } = await svc.library(U);
    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({ source: 'label', nutrients: { kcal: 500 } });
  });
});
