/**
 * Live check of the Estimate call (DECISIONS #104): a restaurant estimate that looks up published
 * nutrition, so web search and structured outputs run in one request, and a home-cooked one with no
 * search. Words only, no photos: two calls, a few cents.
 *
 *   pnpm --filter @cycling-coach/api estimate:smoke
 *
 * Run after changing the estimate prompts, the search tool or how the answer is read.
 */
import { FoodAi, type CallUsage } from '@cycling-coach/coach';
import { estimateFromReading } from '@cycling-coach/core';
import type { EstimateInput } from '@cycling-coach/shared';
import { loadEnv } from '../lib/env';

const env = loadEnv(process.env);
if (!env.CLAUDE_API_KEY) {
  console.error('CLAUDE_API_KEY is not set.');
  process.exit(1);
}
const ai = new FoodAi({ apiKey: env.CLAUDE_API_KEY });

const usd = (u: CallUsage | undefined) => (u ? `$${u.costUsd.toFixed(4)} · ${u.inputTokens} in / ${u.outputTokens} out · ${u.webSearches ?? 0} searches` : 'no usage');

let failed = false;
async function check(label: string, input: EstimateInput, expectSearch: boolean) {
  const started = Date.now();
  const r = await ai.estimateMeal(input, { timezone: 'America/Vancouver' });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!r.ok) {
    failed = true;
    console.log(`✗ ${label} (${secs} s): ${r.error}${r.status ? ` [${r.status}]` : ''} · ${usd(r.usage)}`);
    return;
  }
  const result = estimateFromReading(r.value.reading, { kind: input.kind, search: r.value.search, sources: r.value.sources });
  const searched = (r.usage.webSearches ?? 0) > 0;
  const ok = result.items.length > 0 && (!expectSearch || searched) && (expectSearch || !searched);
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${label} (${secs} s) · search ${result.search} · ${usd(r.usage)}`);
  for (const item of result.items) console.log(`    ${item.name}: ${item.kcal} kcal (${item.low}–${item.high}) · ${item.why}${item.source ? ` · ${item.source}` : ''}`);
  for (const f of result.found) console.log(`    found ${f.from}: ${f.text}`);
  if (r.value.sources.length) console.log(`    ${r.value.sources.length} pages came back from search`);
}

await check(
  'Restaurant with search',
  { kind: 'restaurant', place: "McDonald's · Vancouver", text: 'Big Mac, medium fries, medium Coke', images: [], search: true },
  true,
);
await check(
  'Home-cooked, no search',
  { kind: 'home', dish: 'Lasagna', text: 'Beef and pork, ricotta, mozzarella, tomato sauce. About a sixth of a 9x13 pan. Side salad with ranch.', images: [], search: false },
  false,
);
process.exit(failed ? 1 : 0);
