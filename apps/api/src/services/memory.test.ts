import { collections, createMemory, ensureIndexes, listMemories, saveProfile, type Collections } from '@cycling-coach/db';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendMessage, startThread, type CoachDeps } from './coach';
import { MemoryService } from './memory';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('memory_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
// 23:30 UTC on Nov 3 is already Nov 4 in Auckland.
const NOW = new Date('2026-11-03T23:30:00Z');
const service = (now = NOW) => new MemoryService(c, () => now);

beforeEach(async () => {
  await Promise.all([c.memories.deleteMany({}), c.profiles.deleteMany({}), c.threads.deleteMany({}), c.messages.deleteMany({})]);
  await saveProfile(c, U, { ftpZwift: 250, weightKg: 70, weightSource: 'manual', timezone: 'Pacific/Auckland' }, NOW);
});

const created = async (input: Parameters<MemoryService['create']>[1]) => {
  const m = await service().create(U, input, 'user');
  if ('error' in m) throw new Error(m.error);
  return m;
};

describe('MemoryService (DECISIONS #79)', () => {
  it('saves a note with no date as long-term and a dated one as short-term', async () => {
    expect((await created({ text: 'Rides indoors' })).until).toBeUndefined();
    expect((await created({ text: 'Away', until: '2026-11-11' })).until).toBe('2026-11-11');
  });

  it("checks dates against the athlete's own day, not the server's", async () => {
    expect(await service().create(U, { text: 'x', until: '2026-11-03' }, 'user')).toEqual({ error: '2026-11-03 has already passed.' });
    expect('error' in (await service().create(U, { text: 'x', until: '2026-11-04' }, 'user'))).toBe(false);
  });

  it('refuses a date that does not exist', async () => {
    expect(await service().create(U, { text: 'x', until: '2027-02-30' }, 'user')).toEqual({ error: "2027-02-30 isn't a real date." });
  });

  it('turns a short-term note long-term and keeps it visible', async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    const result = await service().update(U, note.id, { unset: ['until'] });
    expect(result).toMatchObject({ memory: { text: 'Away' }, previous: { until: '2026-11-11' } });
    const [stored] = await listMemories(c, U);
    expect(stored!.until).toBeUndefined();
    expect(await c.memories.findOne({ text: 'Away' })).not.toHaveProperty('until');
  });

  it('prefers unset when a patch has both', async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    const result = await service().update(U, note.id, { until: '2026-11-20', unset: ['until'] });
    expect(result).toMatchObject({ memory: { text: 'Away' } });
    expect((await listMemories(c, U))[0]!.until).toBeUndefined();
  });

  it('does not add a day each time the same date comes back', async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    await service().update(U, note.id, { text: 'Away for work', until: '2026-11-11' });
    await service().update(U, note.id, { until: '2026-11-11' });
    expect((await listMemories(c, U))[0]).toMatchObject({ text: 'Away for work', until: '2026-11-11' });
  });

  it('lets the text change on the last day, when the date has just passed', async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    const graceDay = new Date('2026-11-12T00:00:00Z');
    expect(await service(graceDay).update(U, note.id, { text: 'Back', until: '2026-11-11' })).toMatchObject({ memory: { text: 'Back' } });
  });

  it('refuses to edit an expired note without a new date, and revives it with one', async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    const later = service(new Date('2026-11-20T00:00:00Z'));
    expect(await later.update(U, note.id, { text: 'Back' })).toEqual({ error: 'That note has expired. Give it a new date to keep it.' });
    expect(await later.update(U, note.id, { until: '2026-11-25' })).toMatchObject({ memory: { until: '2026-11-25' } });
  });

  it("never touches another athlete's note", async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    expect(await service().update(OTHER, note.id, { text: 'Mine' })).toBeNull();
    expect(await service().review(OTHER, note.id)).toBeNull();
    expect(await service().revert(OTHER, note.id, { from: { text: 'Away', until: '2026-11-11' }, to: { text: 'Mine' } })).toBeNull();
    expect(await service().remove(OTHER, note.id)).toBeNull();
    expect((await listMemories(c, U))[0]!.text).toBe('Away');
  });

  it('starts the review date again on Keep and on an edit', async () => {
    const note = await created({ text: 'Rides indoors' });
    expect(note.reviewedAt).toBeUndefined();
    const kept = new Date('2027-06-01T00:00:00Z');
    expect((await service(kept).review(U, note.id))?.reviewedAt).toBe(kept.toISOString());
    const edited = new Date('2027-07-01T00:00:00Z');
    await service(edited).update(U, note.id, { text: 'Rides indoors on weekdays' });
    expect((await listMemories(c, U))[0]!.reviewedAt).toBe(edited.toISOString());
  });

  it('undoes an update, including back to a date that has since passed', async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    await service().update(U, note.id, { text: 'Away longer', until: '2026-11-20' });
    const undo = { from: { text: 'Away longer', until: '2026-11-20' }, to: { text: 'Away', until: '2026-11-11' } };
    expect(await service(new Date('2026-11-15T00:00:00Z')).revert(U, note.id, undo)).toMatchObject({ text: 'Away', until: '2026-11-11' });
  });

  it('undoes a move to long-term', async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    await service().update(U, note.id, { unset: ['until'] });
    expect(await service().revert(U, note.id, { from: { text: 'Away' }, to: { text: 'Away', until: '2026-11-11' } })).toMatchObject({ until: '2026-11-11' });
  });

  it('will not undo over a later edit', async () => {
    const note = await created({ text: 'Away', until: '2026-11-11' });
    await service().update(U, note.id, { text: 'Coach wording' });
    await service().update(U, note.id, { text: 'My wording' });
    const stale = { from: { text: 'Coach wording', until: '2026-11-11' }, to: { text: 'Away', until: '2026-11-11' } };
    expect(await service().revert(U, note.id, stale)).toBeNull();
    expect((await listMemories(c, U))[0]!.text).toBe('My wording');
  });
});

describe('what the coach is sent, over real turns', () => {
  /** A coach that says "ok" and keeps every request's messages. */
  function deps(clock: { now: Date }) {
    const sent: string[] = [];
    const engine = {
      async *runTurn(args: { messages: { role: string; content: unknown }[]; persist: (m: object) => Promise<void> }) {
        const last = args.messages.filter((m) => m.role === 'system').at(-1);
        sent.push(JSON.stringify(last?.content));
        await args.persist({ role: 'assistant', kind: 'assistant', content: [{ type: 'text', text: 'ok' }] });
        yield { type: 'text_delta', text: 'ok' };
      },
      generateTitle: async () => null,
    };
    const d = {
      c,
      engine,
      training: { fitnessOn: async () => undefined },
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

  it('sends a note once, not again while it is unchanged, says when it lapses, then goes quiet', async () => {
    const clock = { now: new Date('2026-11-05T00:00:00Z') };
    const { d, sent } = deps(clock);
    await createMemory(c, U, "Away for work Wed Nov 11, can't train", 'coach', clock.now, '2026-11-11');
    const thread = await startThread(d, U);
    expect(JSON.stringify(thread)).not.toContain('Away for work');

    await say(d, thread!.id, 'hello');
    expect(sent.at(-1)).toContain('(until Wed Nov 11)');

    await say(d, thread!.id, 'again');
    expect(sent.at(-1)).not.toContain('Short-term');

    // Thursday in Auckland is the grace day: still current, so still nothing new to send.
    clock.now = new Date('2026-11-12T00:00:00Z');
    await say(d, thread!.id, 'the day after');
    expect(sent.at(-1)).not.toContain('Short-term');

    // Friday: it has lapsed.
    clock.now = new Date('2026-11-13T00:00:00Z');
    await say(d, thread!.id, 'two days after');
    expect(sent.at(-1)).toContain('Short-term notes: none current');

    await say(d, thread!.id, 'and again');
    expect(sent.at(-1)).not.toContain('Short-term');
  });

  it('leaves an expired note out of a new thread altogether', async () => {
    const clock = { now: new Date('2026-11-20T00:00:00Z') };
    const { d, sent } = deps(clock);
    await createMemory(c, U, 'Away for work', 'coach', new Date('2026-11-05T00:00:00Z'), '2026-11-11');
    const thread = await startThread(d, U);
    await say(d, thread!.id, 'hello');
    expect(sent.at(-1)).not.toContain('Away for work');
    expect(sent.at(-1)).not.toContain('Short-term');
  });

  it('does not resend the athlete block when a short-term note is added', async () => {
    const clock = { now: new Date('2026-11-05T00:00:00Z') };
    const { d, sent } = deps(clock);
    const thread = await startThread(d, U);
    await say(d, thread!.id, 'hello');
    await createMemory(c, U, 'Busy this week', 'coach', clock.now, '2026-11-08');
    await say(d, thread!.id, 'again');
    expect(sent.at(-1)).toContain('Busy this week');
    expect(sent.at(-1)).not.toContain('This replaces the athlete context');
  });

  it('does resend the block for a long-term note, as before', async () => {
    const clock = { now: new Date('2026-11-05T00:00:00Z') };
    const { d, sent } = deps(clock);
    const thread = await startThread(d, U);
    await say(d, thread!.id, 'hello');
    await createMemory(c, U, 'Rides indoors on weekdays', 'coach', clock.now);
    await say(d, thread!.id, 'again');
    expect(sent.at(-1)).toContain('This replaces the athlete context');
    expect(sent.at(-1)).toContain('Rides indoors on weekdays');
  });
});
