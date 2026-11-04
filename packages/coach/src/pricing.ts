import type { CoachUsage } from '@cycling-coach/shared';

interface Rate {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * USD per million tokens, from Anthropic's pricing page (2026-11). An ESTIMATE for the spend line and
 * `ai_calls`: the Console's usage page is the source of truth. Cache writes are 1.25× input for the
 * 5-minute TTL and 2× for the 1-hour TTL.
 */
const PRICES: Record<string, Rate> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  // Server-side fallbacks can route a refused request to these.
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
};

/** Haiku 5.5 has a second rate card above this prompt size, counting cached tokens too. */
const HAIKU_LONG_PROMPT = 100_000;
const HAIKU_LONG = { input: 0.5, output: 2.5, cacheRead: 0.05 };

const warned = new Set<string>();

function rateFor(model: string, promptTokens: number): Rate {
  if (model === 'claude-haiku-5-5' && promptTokens > HAIKU_LONG_PROMPT) return HAIKU_LONG;
  const rate = PRICES[model];
  if (rate) return rate;
  // Priced as the dearest current model so spend is never under-counted, but say so.
  if (!warned.has(model)) {
    warned.add(model);
    console.warn(`pricing: no rate for ${model}, using claude-opus-5-5`);
  }
  return PRICES['claude-opus-5-5']!;
}

export interface PricedUsage extends CoachUsage {
  /** The part of `cacheWriteTokens` written with the 1-hour TTL. */
  cacheWrite1hTokens?: number;
}

export function estimateCostUsd(model: string, usage: PricedUsage): number {
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const p = rateFor(model, prompt);
  const longWrites = Math.min(usage.cacheWrite1hTokens ?? 0, usage.cacheWriteTokens);
  const cost =
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    usage.cacheReadTokens * p.cacheRead +
    (usage.cacheWriteTokens - longWrites) * p.input * 1.25 +
    longWrites * p.input * 2;
  return cost / 1_000_000;
}

interface ApiTokens {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens?: number | null } | null;
}

/** The shape of `message.usage`, loose enough for both the plain and beta SDK types. */
export interface ApiUsage extends ApiTokens {
  iterations?: readonly (ApiTokens & { model?: string | null })[] | null;
}

const tokensOf = (u: ApiTokens): PricedUsage => ({
  inputTokens: u.input_tokens ?? 0,
  outputTokens: u.output_tokens ?? 0,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
});

/**
 * What one API response used and cost. `usage.iterations` is the per-attempt record: top-level usage
 * covers only the attempt that produced the returned message, so a server-side fallback would
 * otherwise drop the attempt that was declined. An iteration with no model ran on `model`.
 */
export function priceUsage(model: string, usage: ApiUsage): { usage: CoachUsage; costUsd: number } {
  const attempts = usage.iterations?.length ? usage.iterations : [usage];
  const total: CoachUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let costUsd = 0;
  for (const attempt of attempts) {
    const tokens = tokensOf(attempt);
    total.inputTokens += tokens.inputTokens;
    total.outputTokens += tokens.outputTokens;
    total.cacheReadTokens += tokens.cacheReadTokens;
    total.cacheWriteTokens += tokens.cacheWriteTokens;
    const served = ('model' in attempt ? attempt.model : null) ?? model;
    costUsd += estimateCostUsd(served, tokens);
  }
  return { usage: total, costUsd };
}

/** Roughly how fast a model writes, for a stream stopped before it reported its output tokens. */
const OUTPUT_TOKENS_PER_SECOND = 60;
const MIN_ESTIMATED_OUTPUT = 50;

/** An output estimate for a stopped stream. Thinking is billed but never visible, so time is all there is. */
export function estimateOutputTokens(elapsedMs: number): number {
  return Math.max(MIN_ESTIMATED_OUTPUT, Math.round((elapsedMs / 1000) * OUTPUT_TOKENS_PER_SECOND));
}
