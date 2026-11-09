import { clearOutlook, collections, createEvent, createGoal, ensureIndexes, getOutlook, revertOutlook, saveProfile, setOutlook, type Collections } from '@cycling-coach/db';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendMessage, startThread, type CoachDeps } from './coach';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-11-07T18:00:00Z');

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('outlook_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.coachOutlook.deleteMany({}), c.calendarEvents.deleteMany({}), c.goals.deleteMany({}), c.profiles.deleteMany({}), c.threads.deleteMany({}), c.messages.deleteMany({})]);
  await saveProfile(c, U, { ftpZwift: 345, weightKg: 72, weightSource: 'manual', timezone: 'America/Vancouver' }, NOW);
});

describe('the coach’s outlook (DECISIONS #101)', () => {
  it('is one per athlete, and a rewrite hands back what it said before', async () => {
    expect((await setOutlook(c, U, 'First', 'coach', NOW)).previous).toBeNull();
    const second = await setOutlook(c, U, 'Second', 'coach', NOW);
    expect(second.previous?.text).toBe('First');
    expect(await getOutlook(c, U)).toMatchObject({ text: 'Second', source: 'coach' });
    expect(await c.coachOutlook.countDocuments({ userId: U })).toBe(1);
  });

  it('undoes a rewrite only while it still says what the coach wrote', async () => {
    await setOutlook(c, U, 'Before', 'coach', NOW);
    await setOutlook(c, U, 'After', 'coach', NOW);
    expect(await revertOutlook(c, U, 'After', 'Before', NOW)).toMatchObject({ text: 'Before' });
    await setOutlook(c, U, 'Edited by the athlete', 'user', NOW);
    expect(await revertOutlook(c, U, 'Before', 'Something', NOW)).toBe('changed');
    expect((await getOutlook(c, U))!.text).toBe('Edited by the athlete');
  });

  it('undoes the first one by clearing it, and can be cleared', async () => {
    await setOutlook(c, U, 'Only', 'coach', NOW);
    expect(await revertOutlook(c, U, 'Only', null, NOW)).toBeNull();
    expect(await getOutlook(c, U)).toBeNull();
    await setOutlook(c, U, 'Again', 'user', NOW);
    expect(await clearOutlook(c, U)).toBe(true);
    expect(await getOutlook(c, U)).toBeNull();
  });
});

describe('what the coach is sent about events and its outlook, over real turns', () => {
  function deps(clock: { now: Date }) {
    const sent: string[] = [];
    const engine = {
      async *runTurn(args: { messages: { role: string; content: unknown }[]; persist: (m: object) => Promise<void> }) {
        sent.push(JSON.stringify(args.messages.filter((m) => m.role === 'system').at(-1)?.content));
        await args.persist({ role: 'assistant', kind: 'assistant', content: [{ type: 'text', text: 'ok' }] });
        yield { type: 'text_delta', text: 'ok' };
      },
      generateTitle: async () => null,
    };
    const d = {
      c,
      engine,
      training: { fitnessOn: async () => undefined, hasRides: async () => false },
      intervalsConnected: async () => false,
      events: {},
      food: {},
      now: () => clock.now,
    } as unknown as CoachDeps;
    return { d, sent };
  }
  async function say(d: CoachDeps, threadId: string, text: string) {
    for await (const event of sendMessage(d, U, threadId, { text })) void event;
  }

  it('sends an event months away and the outlook once, the weeks to go every turn', async () => {
    const clock = { now: NOW };
    const { d, sent } = deps(clock);
    const e = await createEvent(c, U, { date: '2027-09-11', kind: 'race', type: 'race', platform: 'garmin', title: 'Made-up Gran Fondo', priority: 'A', tentative: false, eventInfo: { type: 'gran_fondo', distanceKm: 142 } }, { source: 'manual' }, NOW);
    await createGoal(c, U, { horizon: 'long', title: 'Made-up Gran Fondo', event: true, targetDate: '2027-09-11', eventId: e.id, weight: 'important', done: false, primary: false }, NOW);
    await setOutlook(c, U, 'Main focus is 5-min power; the fondo is far off.', 'coach', NOW);
    const thread = await startThread(d, U);

    await say(d, thread!.id, 'plan my week');
    expect(sent.at(-1)).toContain('Gran fondo event (A) · Made-up Gran Fondo · 142 km · goal: important');
    expect(sent.at(-1)).toContain('Main focus is 5-min power');
    expect(sent.at(-1)).toContain('Events ahead: Made-up Gran Fondo (A, important) in 44 weeks.');

    await say(d, thread!.id, 'and again');
    expect(sent.at(-1)).not.toContain('# Upcoming events');
    expect(sent.at(-1)).not.toContain('# Your outlook');
    expect(sent.at(-1)).toContain('Events ahead:');

    await clearOutlook(c, U);
    await say(d, thread!.id, 'cleared it');
    expect(sent.at(-1)).toContain('Your outlook: none now.');
  });
});
