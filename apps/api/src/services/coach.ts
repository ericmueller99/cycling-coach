import {
  buildSystemSnapshot,
  renderAthleteBlock,
  renderCalendarBlock,
  renderTurnContext,
  toUiMessages,
  type ApiMessageParam,
  type CallUsage,
  type CoachEngine,
  type CoachPorts,
  type StoredMessage,
} from '@cycling-coach/coach';
import {
  appendMessage,
  createMemory,
  createThread,
  createWorkout,
  feedbackForActivities,
  forgetMemory,
  getProfile,
  getThread,
  idOf,
  listEvents,
  listLog,
  listThreadMealIdeas,
  listThreadRecipeDrafts,
  toMealIdeas,
  listFeedback,
  listMessages,
  listProposals,
  oid,
  recordAiCall,
  toThreadSummary,
  updateThread,
  type AiRouteStart,
  type Collections,
  type MessageDoc,
  type ThreadDoc,
  type WorkoutDoc,
} from '@cycling-coach/db';
import { dayTotals, slotForTime } from '@cycling-coach/core';
import type { CoachEvent, CoachTier, FitnessDay, IntegrationStatus, IsoDate, SendMessageInput, ThreadSummary, ThreadView, Workout } from '@cycling-coach/shared';
import type { FoodTurnContext } from '@cycling-coach/coach';
import type { ObjectId } from 'mongodb';
import { coachCalendarWindow, loadAthleteContext, localNow } from './athlete';
import type { CoachFoodService } from './coach-food';
import type { EnergyService } from './energy';
import type { FoodService } from './food';
import { createCoachProposal } from './proposals';
import type { TrainingData } from './training-data';
import type { SpendDecision, SpendGuard } from '../lib/spend';
import type { ZwiftEventsService } from './zwift-events';

export interface CoachDeps {
  c: Collections;
  engine: CoachEngine | null;
  /** Synced training data (DECISIONS #49): our own copy, empty for an athlete who never connected. */
  training: TrainingData;
  /** Whether this athlete has intervals.icu connected (DECISIONS #53). */
  intervalsConnected: (userId: string) => Promise<boolean>;
  /** The synced Zwift events (`find_events`); reads our database only. */
  events: Pick<ZwiftEventsService, 'query'>;
  /** Asked before every coach turn; a message refuses it (hosted quotas, DECISIONS #57). */
  spendGuard?: SpendGuard;
  /** Food log, budget and the meal tools. */
  food: { food: FoodService; energy: EnergyService; coachFood: CoachFoodService };
  now: () => Date;
}

const textOf = (d: MessageDoc) =>
  d.content
    .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? (b as { text: string }).text : ''))
    .join('');

const toStored = (d: MessageDoc): StoredMessage => ({
  id: idOf(d),
  kind: d.kind,
  content: d.content,
  createdAt: d.createdAt,
  ...(d.ui ? { ui: d.ui } : {}),
  ...(d.model ? { model: d.model } : {}),
});

/**
 * Stored messages → API messages. A context (system) message from a turn that failed before the
 * coach replied is skipped: the API only accepts a mid-conversation system message when it's last
 * or followed by an assistant turn. The rule is deterministic, so every later request sees the
 * same prefix and replayed thinking blocks stay valid.
 */
export function toApiMessages(docs: MessageDoc[]): ApiMessageParam[] {
  const out: ApiMessageParam[] = [];
  docs.forEach((d, i) => {
    const next = docs[i + 1];
    if (d.role === 'system' && next && next.role !== 'assistant') return;
    out.push({ role: d.role, content: d.content } as ApiMessageParam);
  });
  return out;
}

export async function startThread(deps: CoachDeps, userId: string): Promise<ThreadSummary | null> {
  const athlete = await loadAthleteContext(deps.c, userId);
  if (!athlete) return null;
  const thread = await createThread(deps.c, userId, buildSystemSnapshot(athlete), deps.now());
  return toThreadSummary(thread);
}

export async function getThreadView(deps: CoachDeps, userId: string, threadId: string): Promise<ThreadView | null> {
  const thread = await getThread(deps.c, userId, threadId);
  if (!thread?._id) return null;
  const [docs, proposals, ideaDocs, draftDocs] = await Promise.all([
    listMessages(deps.c, thread._id),
    listProposals(deps.c, userId, thread._id),
    listThreadMealIdeas(deps.c, userId, thread._id),
    listThreadRecipeDrafts(deps.c, userId, thread._id),
  ]);
  const messages = toUiMessages(docs.map(toStored));
  const workoutIds = messages
    .flatMap((m) => m.blocks)
    .flatMap((b) => (b.type === 'workout' ? [oid(b.workoutId)] : []))
    .filter((id): id is ObjectId => id !== null);
  const workoutDocs = workoutIds.length
    ? await deps.c.workouts.find({ _id: { $in: workoutIds }, userId }).toArray()
    : [];
  return {
    thread: toThreadSummary(thread),
    messages,
    proposals,
    workouts: workoutDocs.map(toWorkoutDto),
    mealIdeas: ideaDocs.map(toMealIdeas),
    recipeDrafts: await Promise.all(draftDocs.map((d) => deps.food.coachFood.view(userId, d))),
  };
}

function toWorkoutDto(doc: WorkoutDoc): Workout {
  const { _id, userId: _u, createdAt, archivedAt: _a, ...rest } = doc;
  return { ...rest, id: idOf(doc), createdAt: createdAt.toISOString() } as Workout;
}

/** How long a cached prompt lasts, counted from the start of the request that wrote or read it. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * True for the one turn after a build while its cache is warm. Reading that cache on the build model
 * costs far less than a cold write on the chat model, and "make Tuesday harder" belongs there anyway.
 * One turn only, so everyday chat can't drift onto the build model.
 */
export function warmFollowUp(thread: Pick<ThreadDoc, 'lastBuildStartedAt' | 'buildFollowUpUsed'>, now: Date): boolean {
  if (!thread.lastBuildStartedAt || thread.buildFollowUpUsed) return false;
  return now.getTime() - thread.lastBuildStartedAt.getTime() < CACHE_TTL_MS;
}

/** Why a turn started where it did. The toggle wins: it's what the athlete asked for. */
export function routeStartOf(start: CoachTier, toggle: boolean | undefined, pending: boolean | undefined): AiRouteStart {
  if (start === 'chat') return 'normal';
  return toggle ? 'toggle' : pending ? 'retry' : 'follow_up';
}

/** The turn a call belongs to, for reading its cost and route together. */
interface TurnRef {
  turnId: string;
  routeStart: AiRouteStart;
}

async function logUsage(deps: CoachDeps, userId: string, threadId: ObjectId, purpose: 'coach' | 'title', u: CallUsage, turn: TurnRef) {
  await recordAiCall(deps.c, {
    userId,
    threadId,
    ...turn,
    purpose,
    model: u.model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    costUsd: u.costUsd,
    ...(u.tier ? { tier: u.tier } : {}),
    ...(u.effort ? { effort: u.effort } : {}),
    ...(u.estimated ? { estimated: true } : {}),
    ...(u.stopReason ? { stopReason: u.stopReason } : {}),
    createdAt: deps.now(),
  });
}

/** Today's training-data status and fitness, from the synced wellness. */
async function trainingContext(deps: CoachDeps, userId: string, today: string): Promise<{ status: IntegrationStatus['status']; fitness?: FitnessDay }> {
  try {
    if (!(await deps.intervalsConnected(userId))) return { status: 'not_configured' };
    const fitness = await deps.training.fitnessOn(userId, today);
    return fitness ? { status: 'connected', fitness } : { status: 'connected' };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Today's (or the strip's day's) food against the budget, for the context message. Food is extra
 * context: any failure leaves the line out rather than blocking the coach.
 */
async function foodContext(deps: CoachDeps, userId: string, today: IsoDate, timezone: string, chosen: SendMessageInput['food']): Promise<FoodTurnContext | undefined> {
  try {
    const date = chosen?.date ?? today;
    const [settings, entries, budget] = await Promise.all([
      deps.food.food.getSettings(userId),
      listLog(deps.c, userId, date, date),
      deps.food.energy.budget(userId, date),
    ]);
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(deps.now());
    const eaten = dayTotals(entries, []).get(date)?.eaten ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    return {
      date,
      slot: chosen?.slot ?? slotForTime(settings.slots, hhmm),
      chosen: !!chosen,
      eaten,
      budgetKcal: budget.ready ? budget.total : null,
      proteinTargetG: budget.macros?.proteinG,
      note: budget.dataWarning ? 'Exercise and steps may be missing from the budget (intervals.icu unavailable)' : budget.protectedDay ? 'No deficit today (hard day)' : undefined,
    };
  } catch (err) {
    console.warn('coach food context failed', err instanceof Error ? err.message : err);
    return undefined;
  }
}

export async function* sendMessage(
  deps: CoachDeps,
  userId: string,
  threadId: string,
  input: SendMessageInput,
  signal?: AbortSignal,
): AsyncGenerator<CoachEvent> {
  const { text } = input;
  const { c, engine } = deps;
  const thread = await getThread(c, userId, threadId);
  if (!thread?._id) {
    yield { type: 'error', message: 'Thread not found.', retryable: false };
    return;
  }
  if (!engine) {
    yield { type: 'error', message: 'The coach is offline: CLAUDE_API_KEY is not set on the server.', retryable: false };
    return;
  }
  const decision: SpendDecision = (await deps.spendGuard?.(userId, 'coach')) ?? { allow: true };
  if (!decision.allow) {
    yield { type: 'error', message: decision.message, retryable: false, ...(decision.action ? { action: decision.action } : {}) };
    return;
  }
  const profile = await getProfile(c, userId);
  if (!profile) {
    yield { type: 'error', message: 'No athlete profile yet — run `pnpm db:seed` or fill in the Profile screen.', retryable: false };
    return;
  }
  const tid = thread._id;
  const now = deps.now();
  const { today, localTime } = localNow(profile.timezone, now);
  const training = await trainingContext(deps, userId, today);
  // No live CTL here: it's in the context message every turn. In this block it would differ from the
  // thread's snapshot and change daily, re-sending the whole block into a permanent transcript.
  const athlete = (await loadAthleteContext(c, userId))!;

  // Retrying a turn that failed before the coach replied: reuse the stored message instead of
  // showing the user's text twice. Its orphaned context message is skipped by toApiMessages.
  const [beforeLast, last] = (await listMessages(c, tid)).slice(-2);
  const isRetry = last?.kind === 'context' && beforeLast?.kind === 'user' && textOf(beforeLast) === text;
  const userDoc = isRetry
    ? beforeLast
    : await appendMessage(c, {
        threadId: tid,
        userId,
        role: 'user',
        kind: 'user',
        content: [{ type: 'text', text }],
        createdAt: now,
      });
  yield { type: 'turn_start', messageId: idOf(userDoc) };

  const window = coachCalendarWindow(today);
  const [windowEvents, windowFeedback] = await Promise.all([
    listEvents(c, userId, window.from, window.to),
    listFeedback(c, userId, window),
  ]);
  const calendarBlock = renderCalendarBlock(windowEvents, window.from, window.to, windowFeedback);
  const athleteBlock = renderAthleteBlock(athlete);
  const food = await foodContext(deps, userId, today, profile.timezone, input.food);
  await appendMessage(c, {
    threadId: tid,
    userId,
    role: 'system',
    kind: 'context',
    content: [
      {
        type: 'text',
        text: renderTurnContext({
          today,
          localTime,
          timezone: athlete.profile.timezone,
          training: training.status,
          fitness: training.fitness,
          weight: {
            ftp: athlete.profile.ftpZwift,
            trendKg: athlete.profile.weightKg,
            source: athlete.profile.weightSource,
            latest: athlete.profile.weightLatest,
          },
          calendarBlock,
          athleteBlock,
          food,
          seen: thread.seen,
          ...(decision.coachNote ? { coachNote: decision.coachNote } : {}),
        }),
      },
    ],
    createdAt: now,
  });
  await updateThread(c, tid, { lastMessageAt: now });

  const ports: CoachPorts = {
    training: training.status !== 'not_configured' ? deps.training.port(userId) : null,
    listCalendar: (from, to) => listEvents(c, userId, from, to),
    createProposal: (p) => createCoachProposal(c, userId, tid, p, deps.now()),
    createWorkout: (input) => createWorkout(c, userId, input, 'coach', deps.now()),
    remember: (memoryText) => createMemory(c, userId, memoryText, 'coach', deps.now()),
    forget: (memoryId) => forgetMemory(c, userId, memoryId, deps.now()),
    findEvents: async (query) => ({ result: await deps.events.query(userId, query), timeZone: profile.timezone }),
    feedbackForActivities: (ids) => feedbackForActivities(c, userId, ids),
    listFeedback: ({ start, end, workoutId }) => listFeedback(c, userId, { from: start, to: end, workoutId }),
    food: {
      createMealIdeas: (input) => deps.food.coachFood.createMealIdeas(userId, tid, input),
      createRecipeDraft: (input) => deps.food.coachFood.createRecipeDraft(userId, tid, input),
    },
  };

  const history = await listMessages(c, tid);
  let assistantText = '';
  let textBefore = 0;
  let replied = false;
  const warm = warmFollowUp(thread, now);
  const canBuild = decision.build !== false;
  const start = canBuild && (input.useBuildModel || thread.buildPending || warm) ? 'build' : 'chat';
  if (start === 'build' && warm) await updateThread(c, tid, { buildFollowUpUsed: true });
  const turn: TurnRef = { turnId: idOf(userDoc), routeStart: routeStartOf(start, input.useBuildModel, thread.buildPending) };

  for await (const event of engine.runTurn({
    system: thread.systemSnapshot,
    messages: toApiMessages(history),
    ports,
    today,
    route: { start, canBuild },
    ...(signal ? { signal } : {}),
    persist: async (m) => {
      await appendMessage(c, {
        threadId: tid,
        userId,
        role: m.role,
        kind: m.kind,
        content: m.content,
        createdAt: deps.now(),
        ...(m.ui ? { ui: m.ui } : {}),
        ...(m.model ? { model: m.model } : {}),
      });
      // Only now has the coach really seen this context. A turn that failed first drops the message,
      // and "unchanged" on the retry would point at something it never received.
      if (m.kind === 'assistant' && !replied) {
        replied = true;
        await updateThread(c, tid, { seen: { calendar: calendarBlock, athlete: athleteBlock } });
      }
      if (m.kind === 'assistant') textBefore = assistantText.length;
    },
    recordUsage: (u) => logUsage(deps, userId, tid, 'coach', u, turn),
    onBuildStart: () => updateThread(c, tid, { buildPending: true }),
    onBuildDone: () => updateThread(c, tid, { buildPending: false }),
    onBuildTool: (startedAt) => updateThread(c, tid, { lastBuildStartedAt: startedAt, buildFollowUpUsed: false }),
    ...(deps.spendGuard
      ? {
          checkLimit: async () => {
            const again = await deps.spendGuard!(userId, 'coach');
            return again.allow ? null : { message: again.message, ...(again.action ? { action: again.action } : {}) };
          },
        }
      : {}),
  })) {
    if (event.type === 'text_delta') assistantText += event.text;
    if (event.type === 'discard') assistantText = assistantText.slice(0, textBefore);
    yield event;
  }

  await updateThread(c, tid, { lastMessageAt: deps.now() });

  if (thread.title === 'New chat' && assistantText) {
    const titled = await engine.generateTitle(text, assistantText);
    if (titled) {
      await logUsage(deps, userId, tid, 'title', titled.usage, turn);
      await updateThread(c, tid, { title: titled.title });
      yield { type: 'thread_title', title: titled.title };
    }
  }
}
