import type { CoachUsage } from '@cycling-coach/shared';

/**
 * USD per million tokens, from the claude-api skill's model table (2026-10). An ESTIMATE for the
 * spend line on the Connections card and `ai_calls` — the Console's usage page is the source of
 * truth. Cache writes are priced at 1.25× input (5-minute TTL).
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  // Server-side fallbacks can route a refused request to these.
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
};

export function estimateCostUsd(model: string, usage: CoachUsage): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5']!;
  const cost =
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    usage.cacheReadTokens * p.cacheRead +
    usage.cacheWriteTokens * p.input * 1.25;
  return cost / 1_000_000;
}
