import { HARD_TOKENS, NUDGE_TOKENS, RESTART_TOKENS } from '@cycling-coach/core';
import { TOOLS_HASH } from '@cycling-coach/coach';
import { collections, createProposal, ensureIndexes, listMessages, listThreads, recordAiCall, restartContext, saveProfile, type Collections } from '@cycling-coach/db';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpendGuard } from '../lib/spend';
import { getThreadView, listThreadSummaries, sendMessage, startThread, type CoachDeps } from './coach';
import { createCoachProposal } from './proposals';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('coach_context_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const START = new Date('2026-11-04T12:00:00Z');
const after = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

beforeEach(async () => {
  await Promise.all([c.profiles.deleteMany({}), c.threads.deleteMany({}), c.messages.deleteMany({}), c.aiCalls.deleteMany({}), c.proposals.deleteMany({})]);
  await saveProfile(c, U, { ftpZwift: 250, weightKg: 70, weightSource: 'manual', timezone: 'Etc/UTC' }, START);
});

interface Sent {
  system: string[];
  messages: { role: string; content: { type: string; text?: string }[] }[];
}

/** A coach that says "ok" and keeps every request, with a recap that can be scripted. */
function deps(clock: { now: Date }, recap: (transcript: string, signal?: AbortSignal) => Promise<unknown> = async () => summary()) {
  const sent: Sent[] = [];
  const recaps: string[] = [];
  const timeouts: (number | undefined)[] = [];
  const engine = {
    async *runTurn(args: Sent & { persist: (m: object) => Promise<void> }) {
      sent.push({ system: args.system, messages: args.messages });
      await args.persist({ role: 'assistant', kind: 'assistant', content: [{ type: 'thinking', thinking: 'secret reasoning' }, { type: 'text', text: 'ok' }] });
      yield { type: 'text_delta', text: 'ok' };
    },
    recap: async (transcript: string, signal?: AbortSignal, timeoutMs?: number) => {
      recaps.push(transcript);
      timeouts.push(timeoutMs);
      return recap(transcript, signal);
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
  return { d, sent, recaps, timeouts };
}

/** Long enough to get a real summary: anything shorter goes across as it is. */
const longMessage = (text: string) => `${text} ${'and more '.repeat(400)}`;

const summary = (text = '- Agreed to rest on Friday') => ({
  text,
  usage: { inputTokens: 900, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0, model: 'claude-haiku-5-5', costUsd: 0.0001, stopReason: 'end_turn', effort: 'low' },
});

async function say(d: CoachDeps, threadId: string, text: string, signal?: AbortSignal) {
  const events: { type: string; message?: string }[] = [];
  for await (const event of sendMessage(d, U, threadId, { text }, signal)) events.push(event);
  return events;
}

/** What the last turn's coach call would have cost, so the chat looks this big. */
const chatSize = (threadId: string, tokens: number, at: Date) =>
  recordAiCall(c, {
    userId: U,
    threadId: new ObjectId(threadId),
    purpose: 'coach',
    model: 'claude-sonnet-5-5',
    inputTokens: 10,
    outputTokens: 10,
    cacheReadTokens: tokens - 20,
    cacheWriteTokens: 0,
    costUsd: 0.01,
    tier: 'chat',
    createdAt: at,
  });

const stored = (threadId: string) => listMessages(c, new ObjectId(threadId));
const threadDoc = (threadId: string) => c.threads.findOne({ _id: new ObjectId(threadId) });

async function longChat(clock: { now: Date }, d: CoachDeps) {
  const thread = (await startThread(d, U))!;
  await say(d, thread.id, 'Plan my week');
  await say(d, thread.id, 'Friday off please');
  await chatSize(thread.id, RESTART_TOKENS, clock.now);
  return thread.id;
}

describe('the spend guard', () => {
  it('asks once to start a turn, then as a continuation between its calls', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const asked: string[] = [];
    const spendGuard: SpendGuard = async (_userId, use) => {
      asked.push(use);
      return { allow: true };
    };
    const runTurn = d.engine!.runTurn.bind(d.engine);
    const engine = {
      ...d.engine,
      async *runTurn(args: Parameters<typeof runTurn>[0]) {
        yield* runTurn(args);
        await args.checkLimit?.();
        await args.checkLimit?.();
      },
    };
    const guarded = { ...d, engine, spendGuard } as unknown as CoachDeps;
    const thread = (await startThread(guarded, U))!;
    await say(guarded, thread.id, 'Plan my week');
    expect(asked).toEqual(['coach', 'coach_continue', 'coach_continue']);
  });
});

describe('a restart (DECISIONS #80)', () => {
  it('leaves the old messages out, and leaves them alone', async () => {
    const clock = { now: START };
    const { d, sent, recaps } = deps(clock);
    const id = await longChat(clock, d);
    const before = await stored(id);

    clock.now = after(60);
    await say(d, id, 'Back again');

    const request = sent.at(-1)!;
    expect(request.messages[0]).toMatchObject({ role: 'user', content: [{ text: 'Back again' }] });
    expect(JSON.stringify(request.messages)).not.toContain('Plan my week');
    expect(JSON.stringify(request.messages)).not.toContain('secret reasoning');
    expect(request.system).toHaveLength(3);
    expect(request.system[2]).toContain('Agreed to rest on Friday');
    expect(recaps).toHaveLength(1);

    const after_ = await stored(id);
    expect(after_.slice(0, before.length)).toEqual(before);
    expect(after_.length).toBeGreaterThan(before.length);
  });

  it('never gives the summarizer thinking, context messages or tool output', async () => {
    const clock = { now: START };
    const { d, recaps } = deps(clock);
    const id = await longChat(clock, d);
    clock.now = after(60);
    await say(d, id, 'Back again');
    expect(recaps[0]).toContain('Athlete: Plan my week');
    expect(recaps[0]).toContain('Coach: ok');
    expect(recaps[0]).not.toContain('secret reasoning');
    expect(recaps[0]).not.toContain('Calendar');
  });

  it('sends the whole calendar again, because the coach has lost what it saw', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock);
    const id = await longChat(clock, d);
    expect(JSON.stringify(sent.at(-1)!.messages)).toContain('Calendar: unchanged');
    clock.now = after(60);
    await say(d, id, 'Back again');
    const latest = JSON.stringify(sent.at(-1)!.messages);
    expect(latest).toContain('# Calendar');
    expect(latest).not.toContain('Calendar: unchanged');
    expect(latest).not.toContain('This replaces the athlete context');
  });

  it('keeps the new context stable from then on, so its thinking and cache stay valid', async () => {
    const clock = { now: START };
    const { d, sent, recaps } = deps(clock);
    const id = await longChat(clock, d);
    clock.now = after(60);
    await say(d, id, 'Back again');
    const first = sent.at(-1)!;
    clock.now = after(61);
    await say(d, id, 'And another thing');
    const second = sent.at(-1)!;

    expect(recaps).toHaveLength(1);
    expect(second.system).toEqual(first.system);
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
  });

  it('marks where it happened for the chat to show, and counts the chat as small again', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const id = await longChat(clock, d);
    clock.now = after(60);
    await say(d, id, 'Back again');

    const view = await getThreadView(d, U, id);
    const boundary = view!.messages.find((m) => m.blocks.some((b) => b.type === 'text' && b.text === 'Back again'));
    expect(view!.contextBreaks).toEqual([boundary!.id]);
    // Every message is still there for the athlete.
    expect(view!.messages.filter((m) => m.role === 'user')).toHaveLength(3);
  });

  it('records the recap apart from coaching, with no tier, so it stays out of chat fair use', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const id = await longChat(clock, d);
    clock.now = after(60);
    await say(d, id, 'Back again');
    const row = await c.aiCalls.findOne({ purpose: 'recap' });
    expect(row).toMatchObject({ userId: U, model: 'claude-haiku-5-5', threadId: new ObjectId(id) });
    expect(row!.tier).toBeUndefined();
    expect(row!.turnId).toBeDefined();
  });

  it('carries an unfinished build through, and ends the warm follow-up', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const id = await longChat(clock, d);
    await c.threads.updateOne({ _id: new ObjectId(id) }, { $set: { buildPending: true, lastBuildStartedAt: START, buildFollowUpUsed: true } });
    const doc = (await threadDoc(id))!;
    const restarted = await restartContext(c, doc, { systemSnapshot: ['p', 'a', 'r'], context: { startSeq: 4, at: after(60), reason: 'size', toolsHash: 'h' } });
    expect(restarted).toMatchObject({ buildPending: true, seen: { athlete: 'a' } });
    expect(restarted!.lastBuildStartedAt).toBeUndefined();
    expect(restarted!.buildFollowUpUsed).toBeUndefined();
  });
});

describe('when it restarts', () => {
  it('leaves a long chat alone while the conversation is going', async () => {
    const clock = { now: START };
    const { d, sent, recaps } = deps(clock);
    const id = await longChat(clock, d);
    clock.now = after(3);
    await say(d, id, 'One more thing');
    expect(recaps).toEqual([]);
    expect(JSON.stringify(sent.at(-1)!.messages)).toContain('Plan my week');
  });

  it('restarts at the ceiling even then', async () => {
    const clock = { now: START };
    const { d, recaps } = deps(clock);
    const id = await longChat(clock, d);
    await chatSize(id, HARD_TOKENS, after(1));
    clock.now = after(3);
    await say(d, id, 'One more thing');
    expect(recaps).toHaveLength(1);
  });

  it('restarts a small chat left for two weeks', async () => {
    const clock = { now: START };
    const { d, recaps } = deps(clock);
    const thread = (await startThread(d, U))!;
    await say(d, thread.id, 'hello');
    clock.now = after(14 * 24 * 60);
    await say(d, thread.id, 'I am back');
    expect(recaps).toHaveLength(1);
    expect((await threadDoc(thread.id))!.contexts!.at(-1)!.reason).toBe('age');
  });

  it('restarts when the tools changed, and a chat from before contexts existed', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock);
    const thread = (await startThread(d, U))!;
    await say(d, thread.id, 'hello');
    await c.threads.updateOne({ _id: new ObjectId(thread.id) }, { $unset: { contexts: '' } });
    clock.now = after(1);
    await say(d, thread.id, 'and again');
    expect(sent.at(-1)!.system).toHaveLength(3);
    const doc = (await threadDoc(thread.id))!;
    expect(doc.contexts).toHaveLength(1);
    expect(doc.contexts![0]).toMatchObject({ reason: 'tools', toolsHash: TOOLS_HASH });

    clock.now = after(2);
    await say(d, thread.id, 'still here');
    expect((await threadDoc(thread.id))!.contexts).toHaveLength(1);
  });

  it('frees a chat stuck on a tool call with no result', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock);
    const thread = (await startThread(d, U))!;
    await say(d, thread.id, 'hello');
    await c.messages.insertOne({
      threadId: new ObjectId(thread.id),
      userId: U,
      seq: 3,
      role: 'assistant',
      kind: 'assistant',
      content: [{ type: 'tool_use', id: 'lost', name: 'get_fitness', input: {} }],
      createdAt: clock.now,
    });
    clock.now = after(30);
    await say(d, thread.id, 'are you there');
    expect((await threadDoc(thread.id))!.contexts!.at(-1)!.reason).toBe('repair');
    expect(JSON.stringify(sent.at(-1)!.messages)).not.toContain('lost');
  });

  it('leaves a turn another tab may still be running', async () => {
    const clock = { now: START };
    const { d, recaps } = deps(clock);
    const id = await longChat(clock, d);
    // A build that's been going six minutes: its last write is a tool result, not a reply.
    await c.messages.insertOne({ threadId: new ObjectId(id), userId: U, seq: 100, role: 'user', kind: 'tool_results', content: [], createdAt: after(5) });
    clock.now = after(6);
    await say(d, id, 'from my other tab');
    expect(recaps).toEqual([]);
  });

  it('lets only one of two racing restarts win', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const id = await longChat(clock, d);
    const doc = (await threadDoc(id))!;
    const context = { startSeq: 4, at: after(60), reason: 'size' as const, toolsHash: TOOLS_HASH };
    expect(await restartContext(c, doc, { systemSnapshot: ['p', 'a', 'first'], context })).not.toBeNull();
    expect(await restartContext(c, doc, { systemSnapshot: ['p', 'a', 'second'], context })).toBeNull();
    expect((await threadDoc(id))!.systemSnapshot[2]).toBe('first');
  });
});

describe('when the recap has problems', () => {
  it('falls back to the last messages word for word, and the turn goes ahead', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock, async () => null);
    const id = await longChat(clock, d);
    clock.now = after(60);
    const events = await say(d, id, 'Back again');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(sent.at(-1)!.system[2]).toContain('Athlete: Friday off please');
    expect(await c.aiCalls.findOne({ purpose: 'recap' })).toBeNull();
  });

  it('stores nothing when stopped during the recap, so the draft can come back', async () => {
    const clock = { now: START };
    const abort = new AbortController();
    const { d, sent } = deps(clock, async () => {
      abort.abort();
      return null;
    });
    const id = await longChat(clock, d);
    const before = await stored(id);
    const contexts = (await threadDoc(id))!.contexts;
    sent.length = 0;
    clock.now = after(60);

    const events = await say(d, id, 'Back again', abort.signal);

    expect(events).toEqual([{ type: 'error', message: 'Stopped.', retryable: true }]);
    expect(await stored(id)).toEqual(before);
    expect((await threadDoc(id))!.contexts).toEqual(contexts);
    expect(sent).toEqual([]);
  });

  it('keeps one copy of the message when a failed first turn is retried', async () => {
    const clock = { now: START };
    const { d, recaps } = deps(clock);
    const id = await longChat(clock, d);
    clock.now = after(60);
    const failing = {
      ...d,
      engine: {
        ...d.engine,
        runTurn: () => {
          throw new Error('boom');
        },
      },
    } as unknown as CoachDeps;
    await expect(say(failing, id, 'Back again')).rejects.toThrow('boom');

    clock.now = after(61);
    await say(d, id, 'Back again');

    const said = (await stored(id)).filter((m) => m.kind === 'user' && JSON.stringify(m.content).includes('Back again'));
    expect(said).toHaveLength(1);
    expect(recaps).toHaveLength(1);
  });
});

describe('suggesting a new chat', () => {
  it('starts at the nudge size, and stops once the chat has restarted', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const thread = (await startThread(d, U))!;
    await say(d, thread.id, 'hello');
    expect((await getThreadView(d, U, thread.id))!.contextLong).toBe(false);

    await chatSize(thread.id, NUDGE_TOKENS - 1, after(1));
    expect((await getThreadView(d, U, thread.id))!.contextLong).toBe(false);
    await chatSize(thread.id, RESTART_TOKENS, after(2));
    expect((await getThreadView(d, U, thread.id))!.contextLong).toBe(true);

    clock.now = after(60);
    await say(d, thread.id, 'back');
    expect((await getThreadView(d, U, thread.id))!.contextLong).toBe(false);
  });

  it('ignores a stopped call, whose output is only an estimate', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const thread = (await startThread(d, U))!;
    await recordAiCall(c, {
      userId: U,
      threadId: new ObjectId(thread.id),
      purpose: 'coach',
      model: 'claude-sonnet-5-5',
      inputTokens: 0,
      outputTokens: 500_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      estimated: true,
      createdAt: after(1),
    });
    expect((await getThreadView(d, U, thread.id))!.contextLong).toBe(false);
  });
});

describe('open cards', () => {
  const card = (threadId: string, title: string, status: 'pending' | 'dismissed') =>
    createProposal(c, {
      userId: U,
      threadId: new ObjectId(threadId),
      kind: 'plan',
      toolUseId: 't',
      title,
      items: [],
      itemStatus: [status],
      createdAt: START,
    } as never);

  it('lists the ones still waiting with their ids, which nothing else keeps', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock);
    const id = await longChat(clock, d);
    const open = await card(id, 'Build week', 'pending');
    await card(id, 'Old idea', 'dismissed');
    clock.now = after(60);
    await say(d, id, 'Change the plan');
    const recap = sent.at(-1)!.system[2]!;
    expect(recap).toContain(open.id);
    expect(recap).toContain('Build week');
    expect(recap).not.toContain('Old idea');
  });
});

describe('a new chat', () => {
  it('gets a recap of the last chat, and only that', async () => {
    const clock = { now: START };
    const { d, sent, recaps } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, longMessage('Work is crazy this week'));

    clock.now = after(13 * 60);
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'What should I ride today?');

    const request = sent.at(-1)!;
    expect(recaps[0]).toContain('Work is crazy this week');
    expect(request.system).toHaveLength(3);
    expect(request.system[2]).toContain("previous chat, from Wed Nov 4");
    expect(request.system[2]).toContain('Agreed to rest on Friday');
    expect(JSON.stringify(request.messages)).not.toContain('Work is crazy');
    expect((await threadDoc(second.id))!.contexts!.at(-1)!.reason).toBe('carry');
  });

  it('does it once, on the first message', async () => {
    const clock = { now: START };
    const { d, recaps } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, longMessage('hello'));
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'one');
    await say(d, second.id, 'two');
    expect(recaps).toHaveLength(1);
  });

  it('shows no divider: nothing was cut out of this chat', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, 'hello');
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'one');
    expect((await getThreadView(d, U, second.id))!.contextBreaks).toEqual([]);
  });

  it('starts blank when the last chat is more than a week old', async () => {
    const clock = { now: START };
    const { d, sent, recaps } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, 'hello');
    clock.now = after(8 * 24 * 60);
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'one');
    expect(recaps).toEqual([]);
    expect(sent.at(-1)!.system).toHaveLength(2);
  });

  it('skips a chat the coach never answered', async () => {
    const clock = { now: START };
    const { d, recaps } = deps(clock);
    const answered = (await startThread(d, U))!;
    await say(d, answered.id, longMessage('the real one'));
    clock.now = after(1);
    await startThread(d, U);
    clock.now = after(2);
    const third = (await startThread(d, U))!;
    await say(d, third.id, 'hello');
    expect(recaps).toHaveLength(1);
    expect(recaps[0]).toContain('the real one');
  });

  it('carries on without one if the recap fails and there is nothing to say', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock, async () => null);
    const first = (await startThread(d, U))!;
    await say(d, first.id, longMessage('Knee is sore'));
    const second = (await startThread(d, U))!;
    const events = await say(d, second.id, 'hello');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(sent.at(-1)!.system[2]).toContain('Athlete: Knee is sore');
  });

  it('sends a short chat as it is, with no model call to wait for or pay for', async () => {
    const clock = { now: START };
    const { d, sent, recaps } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, 'Work is crazy this week');
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'What should I ride today?');
    expect(recaps).toEqual([]);
    expect(sent.at(-1)!.system[2]).toContain('Athlete: Work is crazy this week');
    expect(sent.at(-1)!.system[2]).toContain('Coach: ok');
    expect(await c.aiCalls.countDocuments({ purpose: 'recap' })).toBe(0);
  });

  it('keeps what an earlier chat said through a short one', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, longMessage('Knee is sore'));
    clock.now = after(40);
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'Short one');
    clock.now = after(80);
    const third = (await startThread(d, U))!;
    await say(d, third.id, 'hello');
    expect(sent.at(-1)!.system[2]).toContain('Agreed to rest on Friday');
    expect(sent.at(-1)!.system[2]).toContain('Athlete: Short one');
  });

  it('never stacks up headings through a run of short chats', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock);
    for (let i = 0; i < 5; i++) {
      clock.now = after(i * 40);
      const thread = (await startThread(d, U))!;
      await say(d, thread.id, `Short chat ${i}`);
    }
    const recap = sent.at(-1)!.system[2]!;
    expect(recap.match(/# Recap of the athlete's previous chat/g)).toHaveLength(1);
    expect(recap.match(/Background, in case/g)).toHaveLength(1);
    expect(recap).toContain('Athlete: Short chat 0');
    expect(recap).toContain('Athlete: Short chat 3');
  });

  it('gives the recap less time than a restart, because the first reply is waiting on it', async () => {
    const clock = { now: START };
    const { d, timeouts } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, longMessage('hello'));
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'one');
    expect(timeouts).toEqual([6000]);
  });

  it('adds the last words of a chat from the last 12 hours, so "yes, do that" still works', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, longMessage('Should I move the VO2 session?'));
    clock.now = after(31);
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'yes, do that');
    const recap = sent.at(-1)!.system[2]!;
    expect(recap).toContain('Agreed to rest on Friday');
    expect(recap).toContain('# The end of that chat, word for word');
    expect(recap).toContain('Coach: ok');
  });

  it('leaves them out from an older chat, where a reply is no longer likely', async () => {
    const clock = { now: START };
    const { d, sent } = deps(clock);
    const first = (await startThread(d, U))!;
    await say(d, first.id, longMessage('Should I move the VO2 session?'));
    clock.now = after(13 * 60);
    const second = (await startThread(d, U))!;
    await say(d, second.id, 'hello');
    expect(sent.at(-1)!.system[2]).not.toContain('The end of that chat');
  });

  describe('with a card still open in the last chat', () => {
    const plan = (threadId: string) =>
      createProposal(c, { userId: U, threadId: new ObjectId(threadId), kind: 'plan', toolUseId: 't', title: 'Build week', items: [{}], itemStatus: ['pending'], createdAt: START } as never);

    it('brings the card across, so changing it revises it', async () => {
      const clock = { now: START };
      const { d, sent } = deps(clock);
      const first = (await startThread(d, U))!;
      await say(d, first.id, 'Plan my week');
      const open = await plan(first.id);
      clock.now = after(40);
      const second = (await startThread(d, U))!;
      await say(d, second.id, 'Swap Tuesday');
      const recap = sent.at(-1)!.system[2]!;
      expect(recap).toContain('# Cards still open in that chat');
      expect(recap).toContain(open.id);
    });

    it('closes the old card when a new chat replaces it, so both can never be added', async () => {
      const clock = { now: START };
      const { d } = deps(clock);
      const first = (await startThread(d, U))!;
      await say(d, first.id, 'Plan my week');
      const open = await plan(first.id);
      const second = (await startThread(d, U))!;
      await createCoachProposal(c, U, new ObjectId(second.id), { toolUseId: 't2', title: 'Build week v2', kind: 'plan', items: [], replaces: open.id }, after(40));
      expect((await c.proposals.findOne({ _id: new ObjectId(open.id) }))!.itemStatus).toEqual(['dismissed']);
    });

    it("can't touch another athlete's card", async () => {
      const clock = { now: START };
      const { d } = deps(clock);
      const first = (await startThread(d, U))!;
      const open = await plan(first.id);
      await createCoachProposal(c, 'bbbbbbbbbbbbbbbbbbbbbbbb', new ObjectId(first.id), { toolUseId: 't2', title: 'x', kind: 'plan', items: [], replaces: open.id }, after(1));
      expect((await c.proposals.findOne({ _id: new ObjectId(open.id) }))!.itemStatus).toEqual(['pending']);
    });

    it("doesn't pass it on again from a later chat, when it may be settled", async () => {
      const clock = { now: START };
      const { d, sent } = deps(clock);
      const first = (await startThread(d, U))!;
      await say(d, first.id, 'Plan my week');
      const open = await plan(first.id);
      clock.now = after(40);
      const second = (await startThread(d, U))!;
      await say(d, second.id, 'Something else');
      clock.now = after(80);
      const third = (await startThread(d, U))!;
      await say(d, third.id, 'hello');
      expect(sent.at(-1)!.system[2]).not.toContain(open.id);
    });

    it('says so on the latest chat in the list, for the link back to it', async () => {
      const clock = { now: START };
      const { d } = deps(clock);
      const older = (await startThread(d, U))!;
      clock.now = after(1);
      const latest = (await startThread(d, U))!;
      await plan(older.id);
      await plan(latest.id);
      await plan(latest.id);
      const [first, second] = await listThreadSummaries(c, U);
      expect(first).toMatchObject({ id: latest.id, openCards: 2 });
      expect(second!.openCards).toBeUndefined();
    });
  });
});

describe('the list of chats', () => {
  it('leaves the count off when nothing is waiting', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    const thread = (await startThread(d, U))!;
    expect(await listThreadSummaries(c, U)).toEqual([expect.not.objectContaining({ openCards: expect.anything() })]);
    expect((await listThreadSummaries(c, U))[0]!.id).toBe(thread.id);
  });

  it('goes back as far as it is asked, newest first', async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    for (let i = 0; i < 3; i++) {
      clock.now = after(i);
      await startThread(d, U);
    }
    expect(await listThreadSummaries(c, U, 2)).toHaveLength(2);
    expect(await listThreadSummaries(c, U)).toHaveLength(3);
  });

  it('copes with an athlete who has no chats yet', async () => {
    expect(await listThreadSummaries(c, 'bbbbbbbbbbbbbbbbbbbbbbbb')).toEqual([]);
  });

  it("doesn't read a chat's prompt, which is most of the document", async () => {
    const clock = { now: START };
    const { d } = deps(clock);
    await startThread(d, U);
    const find = vi.spyOn(c.threads, 'find');
    await listThreads(c, U);
    expect(find.mock.calls[0]![1]).toMatchObject({ projection: { title: 1, createdAt: 1, lastMessageAt: 1, tags: 1 } });
    find.mockRestore();
  });
});
