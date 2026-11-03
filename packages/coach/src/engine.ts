import Anthropic from '@anthropic-ai/sdk';
import type { CoachEvent, CoachUsage, IsoDate, UiBlock } from '@cycling-coach/shared';
import { estimateCostUsd } from './pricing';
import { findTool, runTool, TOOL_DEFINITIONS, type CoachPorts } from './tools';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CoachConfig {
  apiKey: string;
  model: string;
  effort: Effort;
}

/** A message the engine produced and the caller must append to the thread, in order. */
export interface PersistedMessage {
  role: 'assistant' | 'user';
  kind: 'assistant' | 'tool_results';
  content: unknown[];
  ui?: Exclude<UiBlock, { type: 'text' }>[];
}

export interface CallUsage extends CoachUsage {
  model: string;
  costUsd: number;
  stopReason: string | null;
}

export interface RunTurnArgs {
  /** The frozen system snapshot for this API context. */
  system: string[];
  /** The whole API context, ending with this turn's user + context messages (already persisted). */
  messages: Anthropic.Beta.BetaMessageParam[];
  ports: CoachPorts;
  today: IsoDate;
  persist(message: PersistedMessage): Promise<void>;
  recordUsage(usage: CallUsage): Promise<void>;
  signal?: AbortSignal;
}

/** Tool-loop iterations per turn. A plan with a couple of data lookups uses 3–4. */
const MAX_ITERATIONS = 10;
const MAX_TOKENS = 64_000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const emptyUsage = (): CoachUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

function retryable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  return err instanceof Anthropic.APIError && typeof err.status === 'number' && err.status >= 500;
}

/**
 * The only place Claude is called (ESLint enforces the SDK import boundary). One engine over the
 * Messages API; a different runtime would re-wrap the same tools and ports (docs/DECISIONS.md #1).
 */
export class CoachEngine {
  private readonly client: Anthropic;

  /** `client` is injectable for tests; production builds one from the config. */
  constructor(
    private readonly config: CoachConfig,
    client?: Anthropic,
  ) {
    // CLAUDE_API_KEY is passed explicitly so nothing else in the environment is picked up implicitly.
    this.client = client ?? new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 15 * 60 * 1000 });
  }

  get model() {
    return this.config.model;
  }

  async *runTurn(args: RunTurnArgs): AsyncGenerator<CoachEvent> {
    const total = emptyUsage();
    const messages = [...args.messages];
    const system: Anthropic.Beta.BetaTextBlockParam[] = args.system.map((text) => ({
      type: 'text',
      text,
      // Breakpoints on both system blocks: persona (+ tools before it) is shared by every thread;
      // the athlete block is shared by every turn of this context.
      cache_control: { type: 'ephemeral' },
    }));
    let jsonRetries = 0;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const stream = this.client.beta.messages.stream(
        {
          model: this.config.model,
          max_tokens: MAX_TOKENS,
          system,
          tools: TOOL_DEFINITIONS,
          messages,
          thinking: { type: 'adaptive' },
          output_config: { effort: this.config.effort },
          // Top-level automatic caching covers the growing message history.
          cache_control: { type: 'ephemeral' },
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        },
        args.signal ? { signal: args.signal } : undefined,
      );

      let message: Anthropic.Beta.BetaMessage;
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            const block = event.content_block;
            if (block.type === 'thinking' || block.type === 'redacted_thinking') {
              yield { type: 'thinking', active: true };
            } else if (block.type === 'text') {
              yield { type: 'thinking', active: false };
            } else if (block.type === 'tool_use') {
              yield { type: 'thinking', active: false };
              const tool = findTool(block.name);
              if (tool && 'runningLabel' in tool && tool.runningLabel) {
                yield {
                  type: 'block',
                  block: { type: 'tool', toolUseId: block.id, name: block.name, status: 'running', summary: tool.runningLabel, source: tool.source },
                };
              }
            }
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text };
          }
        }
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (args.signal?.aborted) {
          yield { type: 'error', message: 'Stopped.', retryable: true };
          return;
        }
        if (err instanceof Anthropic.APIError) {
          yield { type: 'error', message: this.describeError(err), retryable: retryable(err) };
          return;
        }
        // With eager input streaming, a tool input the SDK can't parse at all rejects here. The turn
        // never completed (nothing persisted), so re-issue it — a bounded number of times.
        if (jsonRetries++ < 2) continue;
        yield { type: 'error', message: 'The coach sent a malformed tool call. Try again.', retryable: true };
        return;
      }

      const usage: CoachUsage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      };
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.cacheReadTokens += usage.cacheReadTokens;
      total.cacheWriteTokens += usage.cacheWriteTokens;
      await args.recordUsage({
        ...usage,
        model: message.model,
        costUsd: estimateCostUsd(message.model, usage),
        stopReason: message.stop_reason,
      });

      if (message.stop_reason === 'refusal') {
        // Nothing usable to keep: a refused turn is not persisted, so history stays replayable.
        yield {
          type: 'error',
          message: "The coach couldn't answer that one. Try rephrasing.",
          retryable: false,
        };
        break;
      }

      // Verbatim, including thinking blocks — they're only valid when replayed exactly.
      const assistant: Anthropic.Beta.BetaMessageParam = { role: 'assistant', content: message.content };
      await args.persist({ role: 'assistant', kind: 'assistant', content: message.content });
      messages.push(assistant);

      if (message.stop_reason === 'pause_turn') continue;

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) break;

      if (message.stop_reason === 'max_tokens') {
        // A tool input cut off at max_tokens can still parse; never run it. Every tool_use still
        // needs a tool_result or the next request on this thread is rejected.
        await args.persist({
          role: 'user',
          kind: 'tool_results',
          content: toolUses.map((use) => ({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: true,
            content: 'Not run: the response hit the output limit and this call was cut off.',
          })),
        });
        yield { type: 'error', message: 'The response was too long and got cut off. Ask for a shorter plan.', retryable: false };
        break;
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      const ui: Exclude<UiBlock, { type: 'text' }>[] = [];

      // Sequential on purpose: keeps intervals.icu request bursts small, and tool calls in one turn
      // are rarely independent enough for parallelism to matter.
      for (const use of toolUses) {
        const outcome = await runTool(use.name, use.input, { toolUseId: use.id, ports: args.ports, today: args.today });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        });
        if (outcome.ui) {
          ui.push(outcome.ui);
          yield { type: 'block', block: outcome.ui };
        }
      }

      // All results in ONE user message — splitting them teaches the model to stop calling tools
      // in parallel.
      await args.persist({
        role: 'user',
        kind: 'tool_results',
        content: results,
        ...(ui.length ? { ui } : {}),
      });
      messages.push({ role: 'user', content: results });
    }

    yield { type: 'done', usage: total };
  }

  /** A 2–5 word thread title from the first exchange. Cheap: low effort, tiny output. */
  async generateTitle(userText: string, assistantText: string): Promise<{ title: string; usage: CallUsage } | null> {
    try {
      const res = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 2000,
        output_config: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: `Write a 2–5 word title for this cycling-coaching conversation, like "Plan my week" or "VO2 workout for Thursday". Reply with the title only.\n\nAthlete: ${userText.slice(0, 1500)}\n\nCoach: ${assistantText.slice(0, 1500)}`,
          },
        ],
      });
      const text = res.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') return null;
      const title = text.text.trim().replace(/^["'“]|["'”.]$/g, '').slice(0, 60);
      const usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      };
      return {
        title: title || 'New chat',
        usage: { ...usage, model: res.model, costUsd: estimateCostUsd(res.model, usage), stopReason: res.stop_reason },
      };
    } catch {
      return null; // A missing title is cosmetic; never fail the turn over it.
    }
  }

  private describeError(err: InstanceType<typeof Anthropic.APIError>): string {
    if (err instanceof Anthropic.AuthenticationError) return 'Claude rejected the API key. Check CLAUDE_API_KEY.';
    if (err instanceof Anthropic.PermissionDeniedError) return 'This API key cannot use the configured model.';
    if (err instanceof Anthropic.RateLimitError) return 'Claude rate limit hit. Wait a moment and try again.';
    if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
    if (typeof err.status === 'number' && err.status >= 500) return 'Claude is having trouble right now. Try again shortly.';
    return `Claude error: ${err.message}`;
  }
}
