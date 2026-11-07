import { collections, deleteUserData, ensureIndexes, OTHER_COLLECTIONS, USER_COLLECTIONS, type Collections } from '@cycling-coach/db';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const LEAVING = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const STAYING = 'bbbbbbbbbbbbbbbbbbbbbbbb';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('account_data_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

/** Raw, because the shapes don't matter here: only whose a row is. */
const raw = (name: (typeof USER_COLLECTIONS)[number]) => c[name] as unknown as { collectionName: string; insertOne(doc: object): Promise<unknown>; countDocuments(filter: object): Promise<number>; deleteMany(filter: object): Promise<unknown> };

describe('deleteUserData (DECISIONS #95)', () => {
  beforeEach(async () => {
    await Promise.all(USER_COLLECTIONS.map((name) => raw(name).deleteMany({})));
    await c.aiCalls.deleteMany({});
    await c.cnfFoods.deleteMany({});
  });

  /** Each row a little different, so no collection's unique index refuses the second one. */
  const seed = async (userId: string) => {
    for (const name of USER_COLLECTIONS) await raw(name).insertOne({ userId, threadId: new ObjectId(), seq: 1, token: `t-${userId}`, id: `i-${userId}`, provider: 'p', date: '2026-11-01' });
  };

  it('accounts for every collection, so a new one cannot be forgotten', () => {
    const listed = [...USER_COLLECTIONS, ...OTHER_COLLECTIONS].sort();
    expect(listed).toEqual(Object.keys(c).sort());
  });

  it("empties everything of the athlete's and leaves everyone else alone", async () => {
    await seed(LEAVING);
    await seed(STAYING);
    await deleteUserData(c, LEAVING);
    for (const name of USER_COLLECTIONS) {
      expect(await raw(name).countDocuments({ userId: LEAVING }), name).toBe(0);
      expect(await raw(name).countDocuments({ userId: STAYING }), name).toBe(1);
    }
  });

  it('keeps AI costs, with no way back to a chat', async () => {
    const threadId = new ObjectId();
    const cost = { purpose: 'coach', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.5, createdAt: new Date() } as const;
    await c.aiCalls.insertMany([
      { ...cost, userId: LEAVING, threadId, turnId: 't1' },
      { ...cost, userId: STAYING, threadId, turnId: 't2' },
    ]);
    await deleteUserData(c, LEAVING);
    const kept = await c.aiCalls.findOne({ userId: LEAVING });
    expect(kept?.costUsd).toBe(0.5);
    expect(kept?.threadId).toBeUndefined();
    expect(kept?.turnId).toBeUndefined();
    expect((await c.aiCalls.findOne({ userId: STAYING }))?.turnId).toBe('t2');
  });

  it('leaves shared data alone and can run twice', async () => {
    await c.cnfFoods.insertOne({ foodCode: 1 } as never);
    await seed(LEAVING);
    await deleteUserData(c, LEAVING);
    await deleteUserData(c, LEAVING);
    expect(await c.cnfFoods.countDocuments({})).toBe(1);
  });
});
