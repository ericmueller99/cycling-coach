import Anthropic from '@anthropic-ai/sdk';
import type { CoachEvent, CoachTier, CoachUsage, IsoDate, TurnStop, UiBlock } from '@cycling-coach/shared';
import { estimateOutputTokens, priceUsage } from './pricing';
import { defaultRouter, routes, type Effort, type ModelRouter, type RouterSource } from './router';
import { findTool, runTool, TOOL_DEFINITIONS, type CoachPorts } from './tools';

export interface CoachConfig {
  apiKey: string;
  /** Which model does what. Defaults to `DEFAULT_ROUTER`. */
  router?: RouterSource | undefined;
}

/** A message the engine produced and the caller must append to the thread, in order. */
export interface PersistedMessage {
  role: 'assistant' | 'user';
  kind: 'assistant' | 'tool_results';
  content: unknown[];
  ui?: Exclude<UiBlock, { type: 'text' }>[];
  /** The model that wrote it (assistant messages). */
  model?: string;
}

export interface CallUsage extends CoachUsage {
  model: string;
  costUsd: number;
  stopReason: string | null;
  /** Which coach route paid for this call, whatever model ended up serving it. Food calls have none. */
  tier?: CoachTier;
  /** The effort it ran at. Food calls have none. */
  effort?: Effort;
  /** A stopped stream never reports its output tokens, so they're estimated. */
  estimated?: boolean;
}

/** Where a turn starts and whether it may use the build model at all. */
export interface TurnRoute {
  start: CoachTier;
  canBuild: boolean;
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
  /** Defaults to starting on the chat model with the build model available. */
  route?: TurnRoute;
  /** The turn is on the build model and hasn't written anything yet. */
  onBuildStart?(): Promise<void>;
  /** The build is settled: it wrote something, or it couldn't run and the chat model took over. */
  onBuildDone?(): Promise<void>;
  /** A build tool ran on the build model, in a call started at this time. */
  onBuildTool?(startedAt: Date): Promise<void>;
  /** Asked between model calls: a reason to stop the turn here, or null to go on. */
  checkLimit?(): Promise<TurnStop | null>;
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
 * After a mid-output fallback, reasoning and tool calls from before the last `fallback` block belong
 * to the model that was declined. They can't be replayed and were never answered, so they're dropped
 * before the message is stored or acted on.
 */
export function withoutDeclinedAttempt(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const last = content.map((b) => b.type as string).lastIndexOf('fallback');
  if (last === -1) return content;
  const dropped = new Set(['thinking', 'redacted_thinking', 'tool_use']);
  return content.filter((b, i) => i > last || !dropped.has(b.type));
}

/**
 * Every coach call goes through here (ESLint keeps the SDK inside this package). One engine over the
 * Messages API; a different runtime would re-wrap the same tools and ports (docs/DECISIONS.md #1).
 */
export class CoachEngine {
  private readonly client: Anthropic;
  private readonly router: RouterSource;

  /** `client` is injectable for tests; production builds one from the config. */
  constructor(config: CoachConfig, client?: Anthropic) {
    // CLAUDE_API_KEY is passed explicitly so nothing else in the environment is picked up implicitly.
    this.client = client ?? new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 15 * 60 * 1000 });
    this.router = config.router ?? defaultRouter;
  }

  /** The build model, or null when there's only one model and so nothing to route. */
  async buildModel(): Promise<string | null> {
    const router = await this.router();
    return routes(router) ? router.build.model : null;
  }

  /**
   * One coach turn. It runs on the chat model until the model opens a build tool: that call is
   * stopped, nothing from it is kept, and the same messages go to the build model, so a plan is
   * really written there and not copied from a draft. The chat model's earlier tool calls stay in
   * the history, and the build model reads its thinking. The router is read once, here, so a change
   * made during a turn starts with the next one.
   */
  async *runTurn(args: RunTurnArgs): AsyncGenerator<CoachEvent> {
    const total = emptyUsage();
    const messages = [...args.messages];
    const router = await this.router();
    const choice = (t: CoachTier) => (t === 'build' ? router.build : router.chat);
    const route = args.route ?? { start: 'chat', canBuild: true };
    let canBuild = routes(router) && route.canBuild;
    let tier: CoachTier = canBuild ? route.start : 'chat';
    /** A refusal has already moved this turn once, so a second one ends it. */
    let refusalMoved = false;
    if (tier === 'build') await args.onBuildStart?.();

    const system: Anthropic.Beta.BetaTextBlockParam[] = args.system.map((text, i) => ({
      type: 'text',
      text,
      // Breakpoints on both system blocks. The persona (+ tools before it) is shared by every thread,
      // so it gets the long TTL; the athlete block is shared by every turn of this context. A longer
      // TTL must come before shorter ones.
      cache_control: i === 0 ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
    }));
    let jsonRetries = 0;
    let iteration = 0;
    let finished = false;

    while (iteration < MAX_ITERATIONS) {
      if (iteration > 0) {
        const stop = await args.checkLimit?.();
        if (stop) {
          yield { type: 'error', message: stop.message, retryable: false, ...(stop.action ? { action: stop.action } : {}) };
          finished = true;
          break;
        }
      }
      iteration++;

      const { model, effort } = choice(tier);
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          system,
          tools: TOOL_DEFINITIONS,
          messages,
          thinking: { type: 'adaptive' },
          output_config: { effort },
          // Top-level automatic caching covers the growing message history.
          cache_control: { type: 'ephemeral' },
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        },
        args.signal ? { signal: args.signal } : undefined,
      );

      const startedAt = Date.now();
      /** Input usage, known from the first event. It's what a stopped stream still costs. */
      let opened: Anthropic.Beta.BetaUsage | null = null;
      let settled = false;
      let handoff = false;
      /** Tool chips and text shown from this call, to take back if the call is dropped. */
      const shownChips: string[] = [];

      const recordStopped = async (stopReason: 'stopped' | 'handoff' = 'stopped') => {
        if (settled || !opened) return;
        settled = true;
        const tokens = { ...opened, output_tokens: estimateOutputTokens(Date.now() - startedAt) };
        const priced = priceUsage(model, tokens);
        await args.recordUsage({ ...priced.usage, model, costUsd: priced.costUsd, stopReason, tier, effort, estimated: true });
      };

      let message: Anthropic.Beta.BetaMessage;
      try {
        for await (const event of stream) {
          if (event.type === 'message_start') {
            opened = event.message.usage;
          } else if (event.type === 'content_block_start') {
            const block = event.content_block;
            if (block.type === 'thinking' || block.type === 'redacted_thinking') {
              yield { type: 'thinking', active: true };
            } else if (block.type === 'text') {
              yield { type: 'thinking', active: false };
            } else if (block.type === 'tool_use') {
              const tool = findTool(block.name);
              if (tool && 'tier' in tool && tool.tier === 'build') {
                if (tier === 'chat' && canBuild) {
                  handoff = true;
                  break; // Leaving the loop stops the stream.
                }
                if (tier === 'build') await args.onBuildTool?.(new Date(startedAt));
              }
              yield { type: 'thinking', active: false };
              if (tool && 'runningLabel' in tool && tool.runningLabel) {
                shownChips.push(block.id);
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

        if (handoff) {
          await recordStopped('handoff');
          yield { type: 'discard', toolUseIds: shownChips };
          tier = 'build';
          iteration = 0; // Bounded: a turn moves up at most once.
          await args.onBuildStart?.();
          yield { type: 'model', model: router.build.model, tier };
          continue;
        }

        message = await stream.finalMessage();
        settled = true;
        jsonRetries = 0;
      } catch (err) {
        await recordStopped();
        if (args.signal?.aborted) {
          yield { type: 'error', message: 'Stopped.', retryable: true };
          return;
        }
        if (err instanceof Anthropic.APIError) {
          // A build that can't run shouldn't lose the turn: the chat model carries on.
          if (retryable(err) && tier === 'build') {
            yield* this.dropToChat(args, shownChips, router);
            tier = 'chat';
            canBuild = false;
            iteration = 0;
            continue;
          }
          yield { type: 'error', message: this.describeError(err), retryable: retryable(err) };
          return;
        }
        // With eager input streaming, a tool input the SDK can't parse at all rejects here. The turn
        // never completed (nothing persisted), so re-issue it — a bounded number of times.
        if (jsonRetries++ < 2) continue;
        yield { type: 'error', message: 'The coach sent a malformed tool call. Try again.', retryable: true };
        return;
      } finally {
        // A consumer that goes away ends this generator here, without reaching the catch.
        await recordStopped();
      }

      const priced = priceUsage(message.model, message.usage);
      const usage = priced.usage;
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.cacheReadTokens += usage.cacheReadTokens;
      total.cacheWriteTokens += usage.cacheWriteTokens;
      await args.recordUsage({
        ...usage,
        model: message.model,
        costUsd: priced.costUsd,
        stopReason: message.stop_reason,
        tier,
        effort,
      });

      if (message.stop_reason === 'refusal') {
        // Nothing usable to keep: a refused turn is not persisted, so history stays replayable.
        // Models differ in what they decline, so the other one gets one try before giving up.
        if (!refusalMoved && tier === 'chat' && canBuild) {
          refusalMoved = true;
          yield { type: 'discard', toolUseIds: shownChips };
          tier = 'build';
          iteration = 0;
          await args.onBuildStart?.();
          yield { type: 'model', model: router.build.model, tier };
          continue;
        }
        if (!refusalMoved && tier === 'build') {
          refusalMoved = true;
          yield* this.dropToChat(args, shownChips, router);
          tier = 'chat';
          canBuild = false;
          iteration = 0;
          continue;
        }
        yield {
          type: 'error',
          message: "The coach couldn't answer that one. Try rephrasing.",
          retryable: false,
        };
        finished = true;
        break;
      }

      // Verbatim, including thinking blocks — they're only valid when replayed exactly.
      const content = withoutDeclinedAttempt(message.content);
      const assistant: Anthropic.Beta.BetaMessageParam = { role: 'assistant', content };
      await args.persist({ role: 'assistant', kind: 'assistant', content, model: message.model });
      if (tier === 'build') await args.onBuildDone?.();
      messages.push(assistant);

      if (message.stop_reason === 'pause_turn') continue;

      const toolUses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) {
        finished = true;
        break;
      }

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
        finished = true;
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

    if (!finished) {
      yield { type: 'error', message: 'The coach ran out of steps on this one. Ask it to carry on.', retryable: false };
    }
    yield { type: 'done', usage: total };
  }

  /** Tell the client the build model is out for this turn, and take back what the failed call showed. */
  private async *dropToChat(args: RunTurnArgs, shownChips: string[], router: ModelRouter): AsyncGenerator<CoachEvent> {
    await args.onBuildDone?.();
    yield { type: 'discard', toolUseIds: shownChips };
    yield { type: 'model', model: router.chat.model, tier: 'chat', fallback: true };
  }

  /** A 2–5 word thread title from the first exchange. Cheap: low effort, tiny output. */
  async generateTitle(userText: string, assistantText: string): Promise<{ title: string; usage: CallUsage } | null> {
    try {
      const { small } = await this.router();
      const res = await this.client.messages.create({
        model: small,
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
      const { usage, costUsd } = priceUsage(res.model, res.usage);
      return {
        title: title || 'New chat',
        usage: { ...usage, model: res.model, costUsd, stopReason: res.stop_reason, tier: 'chat', effort: 'low' },
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
