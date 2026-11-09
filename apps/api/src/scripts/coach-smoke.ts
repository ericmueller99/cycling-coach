/**
 * Live check that Claude accepts the coach's exact request shape (tools, strict schemas, fallbacks,
 * thinking, cache breakpoints, the context message), that prompt caching works, that a turn can move
 * to the build model, that a thread can cross between models, and that a chat can restart from a
 * recap. A few tiny turns — a few cents.
 *
 *   pnpm --filter @cycling-coach/api coach:smoke
 *
 * Run after changing tools, schemas, the persona or engine request parameters: some failures (like
 * "compiled grammar is too large") only show up against the real API.
 */
import {
  CoachEngine,
  COACH_PERSONA,
  DEFAULT_ROUTER,
  renderRecapSource,
  renderRestartRecap,
  type ApiMessageParam,
  type CallUsage,
  type CoachPorts,
  type StoredMessage,
  type TurnRoute,
} from '@cycling-coach/coach';
import { loadEnv } from '../lib/env';

const env = loadEnv(process.env);
if (!env.CLAUDE_API_KEY) {
  console.error('CLAUDE_API_KEY is not set.');
  process.exit(1);
}
const engine = new CoachEngine({
  apiKey: env.CLAUDE_API_KEY,
  router: () => ({ ...DEFAULT_ROUTER, chat: { ...DEFAULT_ROUTER.chat, effort: 'low' }, build: { ...DEFAULT_ROUTER.build, effort: 'low' } }),
});
const buildModel = await engine.buildModel();
const unused = () => {
  throw new Error('no tools expected here in the smoke test');
};
const ports: CoachPorts = {
  training: null,
  listCalendar: unused,
  getCalendarEvent: unused,
  getEventCourse: unused,
  setOutlook: unused,
  listTimeOff: unused,
  getTimeOff: unused,
  createProposal: async (p) => ({ ...p, id: 'smoke', threadId: 'smoke', itemStatus: p.items.map(() => 'pending' as const) }) as never,
  createWorkout: unused,
  workoutLengths: unused,
  remember: unused,
  updateMemory: unused,
  forget: unused,
  findEvents: unused,
  feedbackForActivities: unused,
  listFeedback: unused,
  food: null,
};

/** The turn's context message, sent as every real turn sends it: a mid-conversation system message. */
const context = { role: 'system', content: 'Today is Thursday, 2026-01-01. Smoke test.' } as unknown as ApiMessageParam;
const persona = [COACH_PERSONA, '# Athlete\nSmoke test — no real athlete data.'];

async function turn(label: string, messages: ApiMessageParam[], route?: TurnRoute, system = persona) {
  const usage: CallUsage[] = [];
  const kept: ApiMessageParam[] = [];
  let text = '';
  let error: string | null = null;
  let moved: string | null = null;
  for await (const e of engine.runTurn({
    system,
    messages,
    ports,
    today: '2026-01-01',
    ...(route ? { route } : {}),
    persist: async (m) => void kept.push({ role: m.role, content: m.content } as ApiMessageParam),
    recordUsage: async (u) => void usage.push(u),
  })) {
    if (e.type === 'text_delta') text += e.text;
    if (e.type === 'discard') text = '';
    if (e.type === 'error') error = e.message;
    if (e.type === 'model') moved = e.model;
  }
  const u = usage.at(-1);
  const cost = usage.reduce((sum, call) => sum + call.costUsd, 0);
  console.log(
    `${label}: ${error ? `FAILED — ${error}` : `ok, replied "${text.trim().slice(0, 40)}"`}` +
      ` · models ${usage.map((call) => `${call.model}${call.estimated ? ' (stopped)' : ''}`).join(' → ')}` +
      (u ? ` · input ${u.inputTokens} · cache write ${u.cacheWriteTokens} · cache read ${u.cacheReadTokens}` : '') +
      ` · ~$${cost.toFixed(4)}`,
  );
  return { ok: !error, cacheRead: u?.cacheReadTokens ?? 0, moved, kept, cost };
}

const fail = (why: string): never => {
  console.error(why);
  process.exit(1);
};

const hello: ApiMessageParam[] = [{ role: 'user', content: 'Smoke test: reply with just "OK" and do not use any tools.' }, context];
const first = await turn('turn 1', hello);
if (!first.ok) fail('The coach request was rejected.');
const second = await turn('turn 2', hello);
if (!second.ok) fail('The coach request was rejected.');
console.log(second.cacheRead > 0 ? 'prompt cache: hit ✓' : 'prompt cache: MISS — something in the prefix varies between requests');
if (second.cacheRead === 0) process.exit(1);

if (!buildModel) fail('The router has one model, so nothing routes.');

// A build tool moves the turn to the build model: the live stream has to stop cleanly.
const ask: ApiMessageParam[] = [
  { role: 'user', content: 'Smoke test: call propose_plan now with one easy 30 minute ride on 2026-01-02. Then reply "done".' },
  context,
];
const built = await turn('build', ask);
if (!built.ok) fail('The build turn failed.');
if (built.moved !== buildModel) fail(`The turn never moved to ${buildModel}.`);
console.log('moved to the build model ✓');

// One thread across both models, the way routing uses it. Build-model thinking can't be read by the
// chat model; that has to be dropped quietly, not rejected.
const followUp = (text: string): ApiMessageParam[] => [{ role: 'user', content: text }, context];
const thread = [...ask, ...built.kept];
const onChat = await turn('down to chat', [...thread, ...followUp('Smoke test: reply with just "OK".')], { start: 'chat', canBuild: false });
if (!onChat.ok) fail('The chat model rejected a thread with build-model thinking in it.');
const history = [...thread, ...followUp('Smoke test: reply with just "OK".'), ...onChat.kept];
const backUp = await turn('back to build', [...history, ...followUp('Smoke test: reply with just "OK".')], { start: 'build', canBuild: true });
if (!backUp.ok) fail('The build model rejected the mixed thread.');
console.log('one thread across both models ✓');

// A restart (DECISIONS #80): the summary comes back, the third system block is accepted, and the new
// context caches and replays like any other.
const said = (kind: 'user' | 'assistant', text: string): StoredMessage => ({ id: kind, kind, content: [{ type: 'text', text }], createdAt: new Date() });
const chat = [said('user', 'Smoke test: my legs are tired, move my workout to Friday.'), said('assistant', 'Done: Friday it is.')];
const recap = await engine.recap(renderRecapSource(chat, 'Etc/UTC'));
if (!recap) fail('The recap came back empty.');
console.log(`recap: ok, "${recap!.text.slice(0, 40).replace(/\n/g, ' ')}" · ${recap!.usage.model} · ~$${recap!.usage.costUsd.toFixed(5)}`);
const fresh = [...persona, renderRestartRecap({ summary: recap!.text, messages: chat, cards: { proposals: [], mealIdeas: [] }, today: '2026-01-01' })];
const restarted = await turn('restart', hello, undefined, fresh);
if (!restarted.ok) fail('The coach rejected a recap block.');
const carried = await turn('after restart', [...hello, ...restarted.kept, ...followUp('Smoke test: reply with just "OK".')], undefined, fresh);
if (!carried.ok) fail('The coach rejected a turn after a restart.');
if (carried.cacheRead === 0) fail('prompt cache: MISS after a restart');
console.log('a chat restarts from a recap ✓');
process.exit(0);
