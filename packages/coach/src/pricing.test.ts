import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateCostUsd, estimateOutputTokens, priceUsage } from './pricing';

const usage = (over = {}) => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...over });
const M = 1_000_000;

describe('estimateCostUsd', () => {
  it.each([
    ['claude-opus-5-5', 4, 20, 0.2],
    ['claude-sonnet-5-5', 2, 10, 0.1],
    ['claude-haiku-5-5', 0.1, 0.5, 0.01],
    ['claude-sonnet-5', 2, 10, 0.2],
  ])('prices %s from the published rates', (model, input, output, read) => {
    // 100K tokens, so Haiku stays on its short-prompt rates.
    const n = 100_000;
    expect(estimateCostUsd(model, usage({ inputTokens: n }))).toBeCloseTo((input * n) / M);
    expect(estimateCostUsd(model, usage({ outputTokens: n }))).toBeCloseTo((output * n) / M);
    expect(estimateCostUsd(model, usage({ cacheReadTokens: n }))).toBeCloseTo((read * n) / M);
  });

  it('prices 5-minute writes at 1.25× and 1-hour writes at 2×', () => {
    expect(estimateCostUsd('claude-sonnet-5-5', usage({ cacheWriteTokens: M }))).toBeCloseTo(2.5);
    expect(estimateCostUsd('claude-sonnet-5-5', { ...usage({ cacheWriteTokens: M }), cacheWrite1hTokens: M })).toBeCloseTo(4);
    expect(estimateCostUsd('claude-sonnet-5-5', { ...usage({ cacheWriteTokens: M }), cacheWrite1hTokens: M / 2 })).toBeCloseTo(3.25);
  });

  it('uses the Haiku long-prompt rates above 100K, cached tokens included', () => {
    expect(estimateCostUsd('claude-haiku-5-5', usage({ inputTokens: 100_000 }))).toBeCloseTo(0.01);
    expect(estimateCostUsd('claude-haiku-5-5', usage({ inputTokens: 1000, cacheReadTokens: 100_000, outputTokens: 1000 }))).toBeCloseTo(
      (1000 * 0.5 + 100_000 * 0.05 + 1000 * 2.5) / M,
    );
  });

  describe('an unknown model', () => {
    afterEach(() => vi.restoreAllMocks());

    it('is priced as Opus and warned about once', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(estimateCostUsd('claude-new-1', usage({ inputTokens: M }))).toBeCloseTo(4);
      estimateCostUsd('claude-new-1', usage({ inputTokens: M }));
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('priceUsage', () => {
  it('uses top-level usage when there are no iterations', () => {
    const { usage: u, costUsd } = priceUsage('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 });
    expect(u).toEqual(usage({ inputTokens: 1000, outputTokens: 100 }));
    expect(costUsd).toBeCloseTo((1000 * 2 + 100 * 10) / M);
  });

  it('adds a cent per web search to the tokens', () => {
    const { costUsd, webSearches } = priceUsage('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2 } });
    expect(webSearches).toBe(2);
    expect(costUsd).toBeCloseTo((1000 * 2 + 100 * 10) / M + 0.02);
  });

  it('bills every attempt of a fallback, each at its own model, not just the final one', () => {
    const { usage: u, costUsd } = priceUsage('claude-opus-5', {
      input_tokens: 500,
      output_tokens: 20,
      iterations: [
        { input_tokens: 1000, output_tokens: 10, model: null },
        { input_tokens: 500, output_tokens: 20, model: 'claude-opus-5' },
      ],
    });
    expect(u.inputTokens).toBe(1500);
    expect(u.outputTokens).toBe(30);
    expect(costUsd).toBeCloseTo((1000 * 5 + 10 * 25 + 500 * 5 + 20 * 25) / M);
  });

  it('reads the 1-hour split from cache_creation', () => {
    const { costUsd } = priceUsage('claude-opus-5-5', {
      cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_1h_input_tokens: 1000 },
    });
    expect(costUsd).toBeCloseTo((1000 * 8) / M);
  });
});

describe('estimateOutputTokens', () => {
  it('never reports less than the floor', () => {
    expect(estimateOutputTokens(0)).toBe(50);
    expect(estimateOutputTokens(10_000)).toBe(600);
  });
});
