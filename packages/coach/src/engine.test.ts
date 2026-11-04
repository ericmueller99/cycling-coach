import type Anthropic from '@anthropic-ai/sdk';
import type { CoachEvent } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { CoachEngine, type PersistedMessage } from './engine';
import type { CoachPorts } from './tools';

type Block = Record<string, unknown>;

/** A scripted stand-in for `client.beta.messages.stream`: one canned response per call. */
function fakeClient(responses: { content: Block[]; stop_reason: string }[]) {
  const calls: unknown[] = [];
  const stream = vi.fn((params: unknown) => {
    calls.push(structuredClone(params));
    const res = responses.shift();
    if (!res) throw new Error('no scripted response left');
    const events = res.content.flatMap((block, index) => {
      const start = { type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : block };
      return block.type === 'text'
        ? [start, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }]
        : [start];
    });
    return {
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
      finalMessage: async () => ({
        id: 'msg',
        model: 'claude-opus-5-5',
        role: 'assistant',
        content: res.content,
        stop_reason: res.stop_reason,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 },
      }),
    };
  });
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, calls };
}

function ports(overrides: Partial<CoachPorts> = {}): CoachPorts {
  return {
    training: {
      listActivities: async () => [
        {
          id: 'i1',
          name: 'Zwift - Race: Club Ladder',
          type: 'VirtualRide',
          startLocal: '2026-10-27T17:32:13',
          distanceM: 28000,
          movingSec: 2513,
          elapsedSec: 2513,
          normalizedWatts: 330,
          trainingLoad: 61,
        },
      ],
      searchActivities: async () => [],
      getActivityDetail: async () => {
        throw new Error('unused');
      },
      getPowerCurves: async () => [],
      getFitness: async () => [],
    },
    listCalendar: async () => [],
    createProposal: async (p) => ({ ...p, id: 'prop1', threadId: 't', itemStatus: p.items.map(() => 'pending' as const) }) as never,
    createWorkout: async () => {
      throw new Error('unused');
    },
    remember: async (text) => ({ id: 'm1', text, source: 'coach', createdAt: '' }),
    forget: async () => null,
    findEvents: async () => ({ result: { items: [], total: 0, all: 0, facets: { types: {}, worlds: {} } }, timeZone: 'UTC' }),
    feedbackForActivities: async () => [],
    listFeedback: async () => [],
    food: null,
    ...overrides,
  };
}

async function run(engine: CoachEngine, p = ports()) {
  const persisted: PersistedMessage[] = [];
  const events: CoachEvent[] = [];
  for await (const e of engine.runTurn({
    system: ['persona', 'athlete'],
    messages: [{ role: 'user', content: 'Pull my last 7 days' }],
    ports: p,
    today: '2026-10-29',
    persist: async (m) => void persisted.push(m),
    recordUsage: async () => {},
  })) {
    events.push(e);
  }
  return { persisted, events };
}

const OPUS = { model: 'claude-opus-5-5', effort: 'medium' as const };
const config = { apiKey: 'test', router: () => ({ chat: OPUS, build: OPUS, small: 'claude-haiku-5-5' }) };

describe('CoachEngine.runTurn', () => {
  it('runs a training-data tool, returns results in one user message, and streams the final text', async () => {
    const { client, calls } = fakeClient([
      {
        content: [{ type: 'tool_use', id: 'tu1', name: 'get_recent_activities', input: { start: '2026-10-22', end: '2026-10-28' } }],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Heavy week — recover today.' }], stop_reason: 'end_turn' },
    ]);
    const { persisted, events } = await run(new CoachEngine(config, client));

    expect(persisted.map((m) => m.kind)).toEqual(['assistant', 'tool_results', 'assistant']);
    const results = persisted[1]!;
    expect(results.ui?.[0]).toMatchObject({
      type: 'tool',
      toolUseId: 'tu1',
      status: 'ok',
      source: 'data',
      summary: 'Pulled 1 ride from intervals.icu · Oct 22 – Oct 28 · 1 race, 0.7 h, load 61',
    });
    expect(results.ui?.[0]).toHaveProperty('rows', ['Tue Oct 27 · Zwift - Race: Club Ladder · 42 min · load 61']);
    // The model sees power and load, not just the name.
    expect(JSON.stringify(results.content)).toContain('NP 330 W');

    // The second request replays the first assistant message verbatim, then the results.
    const second = calls[1] as { messages: { role: string }[] };
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);

    expect(events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe(
      'Heavy week — recover today.',
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', usage: { inputTokens: 200, cacheReadTokens: 160 } });
  });

  it('sends the strict-compatible request shape', async () => {
    const { client, calls } = fakeClient([{ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }]);
    await run(new CoachEngine(config, client));
    const params = calls[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    expect(params).not.toHaveProperty('tool_choice'); // forced tool choice 400s on Opus 5.5
  });

  it('returns invalid tool input to the model as an error instead of running it', async () => {
    const createProposal = vi.fn();
    const { client } = fakeClient([
      { content: [{ type: 'tool_use', id: 'tu1', name: 'propose_plan', input: { title: 'x', items: [{ date: 'tomorrow' }] } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Fixed.' }], stop_reason: 'end_turn' },
    ]);
    const { persisted } = await run(new CoachEngine(config, client), ports({ createProposal }));
    expect(createProposal).not.toHaveBeenCalled();
    const result = (persisted[1]!.content as { is_error?: boolean }[])[0]!;
    expect(result.is_error).toBe(true);
  });

  it('does not persist a refused turn', async () => {
    const { client } = fakeClient([{ content: [], stop_reason: 'refusal' }]);
    const { persisted, events } = await run(new CoachEngine(config, client));
    expect(persisted).toEqual([]);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('never runs tools from a turn cut off at max_tokens', async () => {
    const createProposal = vi.fn();
    const { client } = fakeClient([
      { content: [{ type: 'tool_use', id: 'tu1', name: 'remember', input: { text: 'partial' } }], stop_reason: 'max_tokens' },
    ]);
    const remember = vi.fn();
    const { persisted } = await run(new CoachEngine(config, client), ports({ createProposal, remember }));
    expect(remember).not.toHaveBeenCalled();
    // The dangling tool_use is closed with an error result so the thread stays replayable.
    expect(persisted.map((m) => m.kind)).toEqual(['assistant', 'tool_results']);
    expect((persisted[1]!.content as { is_error: boolean }[])[0]!.is_error).toBe(true);
  });
});
