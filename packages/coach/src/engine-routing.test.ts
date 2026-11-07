import Anthropic from '@anthropic-ai/sdk';
import type { CoachEvent } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { CoachEngine, withoutDeclinedAttempt, type CallUsage, type PersistedMessage, type RunTurnArgs } from './engine';
import type { ModelRouter } from './router';
import type { CoachPorts } from './tools';

type Block = Record<string, unknown>;
type Scripted = { content?: Block[]; stop_reason?: string; error?: Error };

const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';
const planCall: Block = { type: 'tool_use', id: 'plan1', name: 'propose_plan', input: {} };
const readCall = (id: string): Block => ({ type: 'tool_use', id, name: 'remember', input: { text: 'note' } });
const text = (t: string): Block => ({ type: 'text', text: t });
const overloaded = () => new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers());

/** A scripted `messages.stream`. It stops yielding when the consumer leaves, like the real one. */
function fakeClient(script: Scripted[]) {
  const calls: { model: string; messages: unknown[]; system: Block[]; output_config: unknown }[] = [];
  const stream = vi.fn((params: (typeof calls)[number]) => {
    calls.push(structuredClone(params));
    const res = script.shift();
    if (!res) throw new Error('no scripted response left');
    const content = res.content ?? [];
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
        if (res.error) throw res.error;
        for (const [index, block] of content.entries()) {
          yield { type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : block };
          if (block.type === 'text') yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } };
        }
      },
      finalMessage: async () => ({
        id: 'msg',
        model: params.model,
        role: 'assistant',
        content,
        stop_reason: res.stop_reason ?? 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
    };
  });
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, calls };
}

const ROUTER: ModelRouter = { chat: { model: SONNET, effort: 'medium' }, build: { model: OPUS, effort: 'high' }, small: 'claude-haiku-5-5', estimate: { model: 'claude-sonnet-5-5', effort: 'medium' } };

const engineWith = (script: Scripted[], router: ModelRouter | (() => ModelRouter) = ROUTER) => {
  const fake = fakeClient(script);
  return { ...fake, engine: new CoachEngine({ apiKey: 'k', router: typeof router === 'function' ? router : () => router }, fake.client) };
};

const ports = { remember: async (t: string) => ({ id: 'm1', text: t, source: 'coach', createdAt: '' }) } as unknown as CoachPorts;

async function run(engine: CoachEngine, extra: Partial<RunTurnArgs> = {}) {
  const persisted: PersistedMessage[] = [];
  const usage: CallUsage[] = [];
  const events: CoachEvent[] = [];
  for await (const e of engine.runTurn({
    system: ['persona', 'athlete'],
    messages: [{ role: 'user', content: 'build me a plan' }],
    ports,
    today: '2026-11-03',
    persist: async (m) => void persisted.push(m),
    recordUsage: async (u) => void usage.push(u),
    ...extra,
  })) {
    events.push(e);
  }
  return { persisted, usage, events };
}

describe('moving a turn to the build model', () => {
  it('drops the chat model call that opens a build tool and re-issues the same messages', async () => {
    const { engine, calls } = engineWith([{ content: [text('Let me draft that'), planCall] }, { content: [text('Here is your plan.')] }]);
    const { persisted, usage, events } = await run(engine);

    expect(calls.map((c) => c.model)).toEqual([SONNET, OPUS]);
    expect(calls[1]!.messages).toEqual(calls[0]!.messages);
    expect(calls[1]!.output_config).toEqual({ effort: 'high' });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.model).toBe(OPUS);
    expect(JSON.stringify(persisted)).not.toContain('plan1');
    expect(events).toContainEqual({ type: 'discard', toolUseIds: [] });
    expect(events).toContainEqual({ type: 'model', model: OPUS, tier: 'build' });
    // The dropped call still cost something, so it's recorded, as an estimate.
    expect(usage[0]).toMatchObject({ model: SONNET, tier: 'chat', stopReason: 'handoff', estimated: true, inputTokens: 100 });
    expect(usage[1]).toMatchObject({ model: OPUS, tier: 'build', outputTokens: 50 });
    expect(usage[1]!.estimated).toBeUndefined();
  });

  it('keeps earlier tool calls and takes back the chips of the dropped call', async () => {
    const chip: Block = { type: 'tool_use', id: 'ride1', name: 'get_recent_activities', input: {} };
    const { engine, calls } = engineWith([
      { content: [readCall('r1')], stop_reason: 'tool_use' },
      { content: [chip, planCall] },
      { content: [text('Done.')] },
    ]);
    const { events } = await run(engine);
    expect(calls.map((c) => c.model)).toEqual([SONNET, SONNET, OPUS]);
    expect(calls[2]!.messages).toHaveLength(3);
    expect(events).toContainEqual({ type: 'discard', toolUseIds: ['ride1'] });
  });

  it('stays on the chat model when the account has no build allowance', async () => {
    const { engine, calls } = engineWith([{ content: [planCall], stop_reason: 'tool_use' }, { content: [text('ok')] }]);
    const { events } = await run(engine, { route: { start: 'chat', canBuild: false } });
    expect(calls.map((c) => c.model)).toEqual([SONNET, SONNET]);
    expect(events.some((e) => e.type === 'model')).toBe(false);
  });

  it('ignores a requested start on the build model when it isn\'t allowed', async () => {
    const { engine, calls } = engineWith([{ content: [text('ok')] }]);
    await run(engine, { route: { start: 'build', canBuild: false } });
    expect(calls[0]!.model).toBe(SONNET);
  });

  it('does not route when there is one model', async () => {
    const { engine, calls } = engineWith([{ content: [planCall], stop_reason: 'tool_use' }, { content: [text('ok')] }], { ...ROUTER, build: { model: SONNET, effort: 'high' } });
    await run(engine);
    expect(await engine.buildModel()).toBeNull();
    expect(calls.map((c) => c.model)).toEqual([SONNET, SONNET]);
  });

  it('reads the router once per turn, so a change starts with the next turn', async () => {
    let router = ROUTER;
    const source = vi.fn(() => router);
    const { engine, calls } = engineWith([{ content: [readCall('r1')], stop_reason: 'tool_use' }, { content: [text('one')] }, { content: [text('two')] }], source);
    const first = engine.runTurn({ system: ['p', 'a'], messages: [{ role: 'user', content: 'hi' }], ports, today: '2026-01-01' as never, persist: async () => {}, recordUsage: async () => {} });
    await first.next();
    router = { ...ROUTER, chat: { model: OPUS, effort: 'low' } };
    for await (const _ of first);
    expect(source).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.model)).toEqual([SONNET, SONNET]);

    await run(engine);
    expect(calls[2]!.model).toBe(OPUS);
    expect(calls[2]!.output_config).toEqual({ effort: 'low' });
  });

  it('marks the stopped call as a handoff and records the effort of each call', async () => {
    const { engine } = engineWith([{ content: [planCall], stop_reason: 'tool_use' }, { content: [text('ok')] }]);
    const { usage } = await run(engine);
    expect(usage[0]).toMatchObject({ stopReason: 'handoff', effort: 'medium', estimated: true });
    expect(usage[1]).toMatchObject({ tier: 'build', effort: 'high' });
  });

  it('starts on the build model when asked, and reports the build tool with the call start', async () => {
    const onBuildTool = vi.fn(async () => {});
    const { engine, calls } = engineWith([{ content: [planCall], stop_reason: 'tool_use' }, { content: [text('ok')] }]);
    await run(engine, { route: { start: 'build', canBuild: true }, onBuildTool });
    expect(calls.map((c) => c.model)).toEqual([OPUS, OPUS]);
    expect(onBuildTool).toHaveBeenCalledTimes(1);
  });

  it('marks the build pending until it writes something', async () => {
    const order: string[] = [];
    const { engine } = engineWith([{ content: [planCall] }, { content: [text('plan')] }]);
    await run(engine, {
      onBuildStart: async () => void order.push('start'),
      onBuildDone: async () => void order.push('done'),
      persist: async () => void order.push('persist'),
    });
    expect(order).toEqual(['start', 'persist', 'done']);
  });

  it('gives the build model its own iterations when the switch comes on the last one', async () => {
    const reads = Array.from({ length: 9 }, (_, i): Scripted => ({ content: [readCall(`r${i}`)], stop_reason: 'tool_use' }));
    const { engine, calls } = engineWith([...reads, { content: [planCall] }, { content: [text('Your plan.')] }]);
    const { events, persisted } = await run(engine);
    expect(calls.at(-1)!.model).toBe(OPUS);
    expect(persisted.at(-1)!.model).toBe(OPUS);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});

describe('when a model cannot go on', () => {
  it('carries on with the chat model if the build model is unavailable, with the gate off', async () => {
    const onBuildDone = vi.fn(async () => {});
    const { engine, calls } = engineWith([{ content: [planCall] }, { error: overloaded() }, { content: [planCall], stop_reason: 'tool_use' }, { content: [text('ok')] }]);
    const { events } = await run(engine, { onBuildDone });
    expect(calls.map((c) => c.model)).toEqual([SONNET, OPUS, SONNET, SONNET]);
    expect(events).toContainEqual({ type: 'model', model: SONNET, tier: 'chat', fallback: true });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(onBuildDone).toHaveBeenCalled();
  });

  it('reports a failure on the chat model as before', async () => {
    const { engine } = engineWith([{ error: overloaded() }]);
    const { events } = await run(engine);
    expect(events.at(-1)).toMatchObject({ type: 'error', retryable: true });
  });

  it('tries the build model once when the chat model refuses', async () => {
    const { engine, calls } = engineWith([{ stop_reason: 'refusal' }, { content: [text('Sure.')] }]);
    const { persisted, events } = await run(engine);
    expect(calls.map((c) => c.model)).toEqual([SONNET, OPUS]);
    expect(persisted).toHaveLength(1);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('tries the chat model once when the build model refuses', async () => {
    const { engine, calls } = engineWith([{ stop_reason: 'refusal' }, { content: [text('Sure.')] }]);
    await run(engine, { route: { start: 'build', canBuild: true } });
    expect(calls.map((c) => c.model)).toEqual([OPUS, SONNET]);
  });

  it('gives up when both models refuse, storing nothing', async () => {
    const { engine, calls } = engineWith([{ stop_reason: 'refusal' }, { stop_reason: 'refusal' }]);
    const { persisted, events } = await run(engine);
    expect(calls).toHaveLength(2);
    expect(persisted).toEqual([]);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('says so when the turn runs out of steps, instead of ending silently', async () => {
    const reads = Array.from({ length: 10 }, (_, i): Scripted => ({ content: [readCall(`r${i}`)], stop_reason: 'tool_use' }));
    const { engine } = engineWith(reads);
    const { events } = await run(engine, { route: { start: 'chat', canBuild: false } });
    expect(events.at(-2)).toMatchObject({ type: 'error', message: expect.stringContaining('ran out of steps') });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('stops between calls when a limit is reached, and not before the first', async () => {
    const checkLimit = vi.fn(async () => ({ message: 'Trial used up.', action: { label: 'See plans', href: '/billing' } }));
    const { engine, calls } = engineWith([{ content: [readCall('r1')], stop_reason: 'tool_use' }]);
    const { events } = await run(engine, { checkLimit });
    expect(calls).toHaveLength(1);
    expect(checkLimit).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'error', message: 'Trial used up.', retryable: false, action: { label: 'See plans', href: '/billing' } });
  });
});

describe('spend on a stopped stream', () => {
  it('is recorded when the request is aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const { engine } = engineWith([{ error: new Error('aborted') }]);
    const { usage, events } = await run(engine, { signal: abort.signal });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ stopReason: 'stopped', estimated: true });
    expect(events.at(-1)).toMatchObject({ message: 'Stopped.' });
  });

  it('is recorded when the consumer walks away mid-stream', async () => {
    const usage: CallUsage[] = [];
    const { engine } = engineWith([{ content: [text('hello')] }]);
    const turn = engine.runTurn({
      system: ['p'],
      messages: [{ role: 'user', content: 'hi' }],
      ports,
      today: '2026-11-03',
      persist: async () => {},
      recordUsage: async (u) => void usage.push(u),
    });
    await turn.next();
    await turn.return(undefined);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.estimated).toBe(true);
  });

  it('records nothing if the stream never opened', async () => {
    const stream = vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(overloaded()) }),
    }));
    const engine = new CoachEngine({ apiKey: 'k', router: () => ROUTER }, { beta: { messages: { stream } } } as unknown as Anthropic);
    const { usage } = await run(engine);
    expect(usage).toEqual([]);
  });

  it('counts a call only once', async () => {
    const { engine } = engineWith([{ content: [text('hello')] }]);
    const { usage } = await run(engine);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.estimated).toBeUndefined();
  });
});

describe('prompt caching', () => {
  it('keeps the shared persona on the long TTL, before the shorter ones', async () => {
    const { engine, calls } = engineWith([{ content: [text('ok')] }]);
    await run(engine);
    expect(calls[0]!.system.map((b) => b.cache_control)).toEqual([{ type: 'ephemeral', ttl: '1h' }, { type: 'ephemeral' }]);
    expect(calls[0]).toMatchObject({ cache_control: { type: 'ephemeral' } });
  });

  it('adds no breakpoint for a recap block: four is the limit, and the history covers it', async () => {
    const { engine, calls } = engineWith([{ content: [text('ok')] }]);
    await run(engine, { system: ['persona', 'athlete', 'recap'] });
    expect(calls[0]!.system.map((b) => b.cache_control)).toEqual([{ type: 'ephemeral', ttl: '1h' }, { type: 'ephemeral' }, undefined]);
  });
});

describe('recap', () => {
  const haiku = (create: (params: Record<string, unknown>, options: Record<string, unknown>) => unknown) =>
    new CoachEngine({ apiKey: 'k', router: () => ROUTER }, { messages: { create } } as unknown as Anthropic);
  const reply = (content: Block[], stop_reason = 'end_turn') => ({
    model: 'claude-haiku-5-5',
    content,
    stop_reason,
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });

  it('uses the small model with a short leash, and gives the text and its cost', async () => {
    let seen: { params: Record<string, unknown>; options: Record<string, unknown> } | undefined;
    const signal = new AbortController().signal;
    const engine = haiku((params, options) => {
      seen = { params, options };
      return reply([{ type: 'thinking', thinking: '' }, text('- Rest Friday')]);
    });
    const result = await engine.recap('Athlete: hi', signal);
    expect(seen!.params).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } });
    expect(JSON.stringify(seen!.params.messages)).toContain('Athlete: hi');
    expect(seen!.options).toMatchObject({ maxRetries: 0, signal });
    expect(result!.text).toBe('- Rest Friday');
    expect(result!.usage.costUsd).toBeGreaterThan(0);
  });

  it('has no tier, so it stays out of chat fair use', async () => {
    const result = await haiku(() => reply([text('x')])).recap('t');
    expect(result!.usage.tier).toBeUndefined();
  });

  it('gives null rather than throwing, so a recap never fails a turn', async () => {
    expect(await haiku(() => { throw overloaded(); }).recap('t')).toBeNull();
    expect(await haiku(() => reply([])).recap('t')).toBeNull();
    expect(await haiku(() => reply([text('   ')], 'refusal')).recap('t')).toBeNull();
  });
});

describe('withoutDeclinedAttempt', () => {
  it('drops reasoning and tool calls from before the last fallback, and keeps text and everything after', () => {
    const content = [
      { type: 'thinking', thinking: '' },
      { type: 'tool_use', id: 'a' },
      text('kept'),
      { type: 'fallback', from: {}, to: {} },
      { type: 'thinking', thinking: 'later' },
      { type: 'tool_use', id: 'b' },
    ] as never;
    expect(withoutDeclinedAttempt(content).map((b) => b.type)).toEqual(['text', 'fallback', 'thinking', 'tool_use']);
  });

  it('leaves a normal message alone', () => {
    const content = [{ type: 'thinking', thinking: '' }, text('hi')] as never;
    expect(withoutDeclinedAttempt(content)).toBe(content);
  });
});
