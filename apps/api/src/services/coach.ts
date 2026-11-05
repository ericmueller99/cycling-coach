import {
  buildSystemSnapshot,
  hasOpenToolUse,
  renderAthleteBlock,
  CARRY_RECAP_TIMEOUT_MS,
  INLINE_SOURCE_CHARS,
  recapBackground,
  renderCarryRecap,
  renderRecapSource,
  renderRestartRecap,
  renderShortTermBlock,
  renderCalendarBlock,
  renderTurnContext,
  toUiMessages,
  TOOLS_HASH,
  type ApiMessageParam,
  type CallUsage,
  type CoachEngine,
  type CoachPorts,
  type OpenCards,
  type StoredMessage,
} from '@cycling-coach/coach';
import {
  appendMessage,
  contextStartSeq,
  contextTokens,
  createThread,
  createWorkout,
  feedbackForActivities,
  getProfile,
  getThread,
  idOf,
  latestChat,
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
  restartContext,
  toThreadSummary,
  updateThread,
  type AiRouteStart,
  type Collections,
  type MessageDoc,
  type ThreadContextReason,
  type ThreadDoc,
  type WorkoutDoc,
  listThreads,
} from '@cycling-coach/db';
import { activeShortTerm, CACHE_TTL_MS, carriesTail, carrySince, dayTotals, NUDGE_TOKENS, restartReason, slotForTime, todayIn } from '@cycling-coach/core';
import type { CoachEvent, CoachTier, FitnessDay, IntegrationStatus, IsoDate, SendMessageInput, ThreadSummary, ThreadView, Workout } from '@cycling-coach/shared';
import type { FoodTurnContext } from '@cycling-coach/coach';
import type { ObjectId } from 'mongodb';
import { coachCalendarWindow, loadAthleteContext, localNow } from './athlete';
import type { CoachFoodService } from './coach-food';
import type { EnergyService } from './energy';
import type { FoodService } from './food';
import { MemoryService } from './memory';
import { createCoachProposal } from './proposals';
import type { TrainingData } from './training-data';
import type { SpendDecision, SpendGuard } from '../lib/spend';
import type { ZwiftEventsService } from './zwift-events';

/** What a deployment wants the coach to know today, or null for nothing. */
export type CoachContext = (userId: string, today: IsoDate) => Promise<string | null>;

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
  /** Extra text for the turn's context, from the deployment (DECISIONS #72). */
  coachContext?: CoachContext;
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
  const thread = await createThread(deps.c, userId, buildSystemSnapshot(athlete), TOOLS_HASH, deps.now());
  return toThreadSummary(thread);
}

/** The athlete's chats, newest first. The latest says if a card is waiting there, so a new chat can point back at it. */
export async function listThreadSummaries(c: CoachDeps['c'], userId: string, limit?: number): Promise<ThreadSummary[]> {
  const threads = await listThreads(c, userId, limit);
  const [latest, ...rest] = threads;
  const id = latest && oid(latest.id);
  if (!id) return threads;
  const waiting = (await openCards(c, userId, id)).proposals.length;
  return waiting ? [{ ...latest, openCards: waiting }, ...rest] : threads;
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
  const contextBreaks = (thread.contexts ?? []).flatMap((x) => {
    const first = x.startSeq > 0 ? docs.find((d) => d.seq === x.startSeq) : undefined;
    return first ? [idOf(first)] : [];
  });
  return {
    thread: toThreadSummary(thread),
    messages,
    contextBreaks,
    contextLong: (await contextTokens(deps.c, thread)) >= NUDGE_TOKENS,
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

async function logUsage(deps: CoachDeps, userId: string, threadId: ObjectId, purpose: 'coach' | 'title' | 'recap', u: CallUsage, turn: TurnRef) {
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

/** A new API context, ready to start once the athlete's message has a place in the thread. */
interface NextContext {
  recap: string;
  reason: ThreadContextReason;
  usage?: CallUsage | undefined;
}

/** What's still open in a thread: the ids behind these cards aren't anywhere else the coach can see. */
async function openCards(c: CoachDeps['c'], userId: string, threadId: ObjectId): Promise<OpenCards> {
  const [proposals, ideas] = await Promise.all([listProposals(c, userId, threadId), listThreadMealIdeas(c, userId, threadId)]);
  return {
    proposals: proposals.filter((p) => p.itemStatus.includes('pending')).map((p) => ({ id: p.id, kind: p.kind, title: p.title })),
    mealIdeas: ideas
      .filter((m) => m.picked.length === 0)
      .slice(-3)
      .map((m) => ({ id: idOf(m), names: m.ideas.map((i) => i.name) })),
  };
}

/** The recap to restart a thread from, over the messages of its current context. */
async function restartRecap(
  engine: CoachEngine,
  c: CoachDeps['c'],
  userId: string,
  thread: ThreadDoc & { _id: ObjectId },
  docs: MessageDoc[],
  reason: ThreadContextReason,
  when: { today: IsoDate; timezone: string },
  signal?: AbortSignal,
): Promise<NextContext> {
  const messages = docs.map(toStored);
  const [cards, written] = await Promise.all([
    openCards(c, userId, thread._id),
    engine.recap(renderRecapSource(messages, when.timezone, thread.systemSnapshot[2]), signal),
  ]);
  return {
    recap: renderRestartRecap({ summary: written?.text ?? null, messages, cards, today: when.today }),
    reason,
    usage: written?.usage,
  };
}

/** The recap for a new chat: how the athlete's latest one went. Null when they haven't had one lately. */
async function carryRecap(
  engine: CoachEngine,
  c: CoachDeps['c'],
  userId: string,
  thread: ThreadDoc & { _id: ObjectId },
  now: Date,
  when: { today: IsoDate; timezone: string },
  signal?: AbortSignal,
): Promise<NextContext | null> {
  const source = await latestChat(c, userId, thread._id, carrySince(now));
  if (!source) return null;
  const [docs, cards] = await Promise.all([listMessages(c, source._id, contextStartSeq(source)), openCards(c, userId, source._id)]);
  const messages = docs.map(toStored);
  const text = renderRecapSource(messages, when.timezone, recapBackground(source.systemSnapshot[2]));
  // Short enough to send as it is, which is already word for word and keeps any earlier recap.
  const inline = text.length <= INLINE_SOURCE_CHARS;
  const written = inline ? null : await engine.recap(text, signal, CARRY_RECAP_TIMEOUT_MS);
  return {
    recap: renderCarryRecap({
      summary: inline ? text : (written?.text ?? null),
      messages,
      cards,
      withTail: !inline && carriesTail(source.lastMessageAt, now),
      lastDate: todayIn(when.timezone, source.lastMessageAt),
      today: when.today,
    }),
    reason: 'carry',
    usage: written?.usage,
  };
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
  const found = await getThread(c, userId, threadId);
  if (!found?._id) {
    yield { type: 'error', message: 'Thread not found.', retryable: false };
    return;
  }
  let thread = found;
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
  const context = await listMessages(c, tid, contextStartSeq(thread));
  const [beforeLast, last] = context.slice(-2);
  const isRetry = last?.kind === 'context' && beforeLast?.kind === 'user' && textOf(beforeLast) === text;

  // Before the message is stored, so a Stop while the recap is written leaves nothing behind and the
  // draft comes back. A long chat, a stale one, or a new one that follows another (DECISIONS #80).
  const when = { today, timezone: profile.timezone };
  const openToolUse = hasOpenToolUse(context);
  const restart = restartReason({
    tokens: last ? await contextTokens(c, thread) : 0,
    lastMessageAt: thread.lastMessageAt,
    toolsHash: thread.contexts?.at(-1)?.toolsHash,
    currentToolsHash: TOOLS_HASH,
    tail: last ? { finished: last.kind === 'assistant' && !openToolUse, at: last.createdAt } : null,
    openToolUse,
    now,
  });
  const next = restart
    ? await restartRecap(engine, c, userId, thread, context, restart, when, signal)
    : last
      ? null
      : await carryRecap(engine, c, userId, thread, now, when, signal);
  if (signal?.aborted) {
    yield { type: 'error', message: 'Stopped.', retryable: true };
    return;
  }

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
  if (next) {
    const restarted = await restartContext(c, thread, {
      systemSnapshot: buildSystemSnapshot(athlete, next.recap),
      context: { startSeq: userDoc.seq, at: now, reason: next.reason, toolsHash: TOOLS_HASH },
    });
    // Null when another tab restarted it first, so carry on from what that one wrote.
    thread = restarted ?? (await getThread(c, userId, threadId)) ?? thread;
  }
  yield { type: 'turn_start', messageId: idOf(userDoc) };

  const window = coachCalendarWindow(today);
  const [windowEvents, windowFeedback] = await Promise.all([
    listEvents(c, userId, window.from, window.to),
    listFeedback(c, userId, window),
  ]);
  const calendarBlock = renderCalendarBlock(windowEvents, window.from, window.to, windowFeedback);
  const athleteBlock = renderAthleteBlock(athlete);
  const shortTermBlock = renderShortTermBlock(activeShortTerm(athlete.shortTerm, today));
  const food = await foodContext(deps, userId, today, profile.timezone, input.food);
  // Nice to have: a failure costs the coach this line, never the turn.
  const extra = await deps.coachContext?.(userId, today).catch((err: Error) => {
    console.warn('coach context failed', err.message);
    return null;
  });
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
          shortTermBlock,
          food,
          extra: extra ?? undefined,
          seen: thread.seen,
          ...(decision.coachNote ? { coachNote: decision.coachNote } : {}),
        }),
      },
    ],
    createdAt: now,
  });
  await updateThread(c, tid, { lastMessageAt: now });

  const memories = new MemoryService(c, deps.now);
  const ports: CoachPorts = {
    training: training.status !== 'not_configured' ? deps.training.port(userId) : null,
    listCalendar: (from, to) => listEvents(c, userId, from, to),
    createProposal: (p) => createCoachProposal(c, userId, tid, p, deps.now()),
    createWorkout: (input) => createWorkout(c, userId, input, 'coach', deps.now()),
    remember: (input) => memories.create(userId, input, 'coach'),
    updateMemory: (memoryId, patch) => memories.update(userId, memoryId, patch),
    forget: (memoryId) => memories.remove(userId, memoryId),
    findEvents: async (query) => ({ result: await deps.events.query(userId, query), timeZone: profile.timezone }),
    feedbackForActivities: (ids) => feedbackForActivities(c, userId, ids),
    listFeedback: ({ start, end, workoutId }) => listFeedback(c, userId, { from: start, to: end, workoutId }),
    food: {
      createMealIdeas: (input) => deps.food.coachFood.createMealIdeas(userId, tid, input),
      createRecipeDraft: (input) => deps.food.coachFood.createRecipeDraft(userId, tid, input),
    },
  };

  const history = await listMessages(c, tid, contextStartSeq(thread));
  let assistantText = '';
  let textBefore = 0;
  let replied = false;
  const warm = warmFollowUp(thread, now);
  const canBuild = decision.build !== false;
  const start = canBuild && (input.useBuildModel || thread.buildPending || warm) ? 'build' : 'chat';
  if (start === 'build' && warm) await updateThread(c, tid, { buildFollowUpUsed: true });
  const turn: TurnRef = { turnId: idOf(userDoc), routeStart: routeStartOf(start, input.useBuildModel, thread.buildPending) };
  if (next?.usage) await logUsage(deps, userId, tid, 'recap', next.usage, turn);

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
        await updateThread(c, tid, { seen: { calendar: calendarBlock, athlete: athleteBlock, shortTerm: shortTermBlock, ...(extra ? { extra } : {}) } });
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
            const again = await deps.spendGuard!(userId, 'coach_continue');
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
