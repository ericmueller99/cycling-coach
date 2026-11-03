/**
 * Live check that Claude accepts the coach's exact request shape (tools, strict schemas, fallbacks,
 * thinking, cache breakpoints) and that prompt caching works. Two tiny turns — a few cents.
 *
 *   pnpm --filter @cycling-coach/api coach:smoke
 *
 * Run after changing tools, schemas, the persona or engine request parameters: some failures (like
 * "compiled grammar is too large") only show up against the real API.
 */
import { CoachEngine, COACH_PERSONA, type CallUsage, type CoachPorts } from '@cycling-coach/coach';
import { loadEnv } from '../lib/env';

const env = loadEnv(process.env);
if (!env.CLAUDE_API_KEY) {
  console.error('CLAUDE_API_KEY is not set.');
  process.exit(1);
}
const engine = new CoachEngine({ apiKey: env.CLAUDE_API_KEY, model: env.CLAUDE_MODEL, effort: 'low' });
const unused = () => {
  throw new Error('no tools expected in the smoke test');
};
const ports: CoachPorts = {
  training: null,
  listCalendar: unused,
  createProposal: unused,
  createWorkout: unused,
  remember: unused,
  forget: unused,
  findEvents: unused,
  feedbackForActivities: unused,
  listFeedback: unused,
  food: null,
};

async function turn(label: string) {
  const usage: CallUsage[] = [];
  let text = '';
  let error: string | null = null;
  for await (const e of engine.runTurn({
    system: [COACH_PERSONA, '# Athlete\nSmoke test — no real athlete data.'],
    messages: [{ role: 'user', content: 'Smoke test: reply with just "OK" and do not use any tools.' }],
    ports,
    today: '2026-01-01',
    persist: async () => {},
    recordUsage: async (u) => void usage.push(u),
  })) {
    if (e.type === 'text_delta') text += e.text;
    if (e.type === 'error') error = e.message;
  }
  const u = usage[0];
  console.log(
    `${label}: ${error ? `FAILED — ${error}` : `ok, replied "${text.trim().slice(0, 40)}"`}` +
      (u ? ` · model ${u.model} · input ${u.inputTokens} · cache write ${u.cacheWriteTokens} · cache read ${u.cacheReadTokens} · ~$${u.costUsd.toFixed(4)}` : ''),
  );
  return { ok: !error, cacheRead: u?.cacheReadTokens ?? 0 };
}

const first = await turn('turn 1');
if (!first.ok) process.exit(1);
const second = await turn('turn 2');
if (!second.ok) process.exit(1);
console.log(second.cacheRead > 0 ? 'prompt cache: hit ✓' : 'prompt cache: MISS — something in the prefix varies between requests');
process.exit(second.cacheRead > 0 ? 0 : 1);
