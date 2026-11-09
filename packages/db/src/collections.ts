import type { RestartReason } from '@cycling-coach/core';
import type {
  IsoDate,
  Activity,
  ActivityInterval,
  FullSyncProgress,
  PowerCurve,
  PowerPoint,
  WellnessDay,
  CalendarEvent,
  CalendarEventInput,
  CourseAnalysis,
  CoursePoint,
  GoalInput,
  GoalProposal,
  IntervalsLink,
  PlanItem,
  PowerBest,
  Profile,
  ProfileUpdate,
  ProposalChange,
  ProposalItemStatus,
  TimeOffInput,
  EventFilters,
  BodyScanInput,
  BmrSource,
  FoodImageRef,
  FoodInput,
  FoodLogEntry,
  FoodSettings,
  OnboardingFitness,
  OnboardingGoals,
  IngredientLine,
  IngredientMatch,
  MealIdea,
  MealInput,
  Nutrients,
  RecipeDraftLog,
  RecipeInput,
  ThreadTag,
  UiBlock,
  WorkoutInput,
  ZwiftEvent,
} from '@cycling-coach/shared';
import type { Collection, Db, ObjectId } from 'mongodb';

/**
 * Document shapes. Every document carries `userId` (Better Auth's user id) even though there is one
 * user today — tenancy is cheap to carry and miserable to retrofit (docs/DECISIONS.md #4).
 */

export interface ProfileDoc extends Profile {
  _id?: ObjectId;
  userId: string;
  updatedAt: Date;
}

export interface PowerBestDoc extends PowerBest {
  _id?: ObjectId;
  userId: string;
  updatedAt: Date;
}

export interface GoalDoc extends GoalInput {
  _id?: ObjectId;
  userId: string;
  createdAt: Date;
}

export interface MemoryDoc {
  _id?: ObjectId;
  userId: string;
  text: string;
  source: 'user' | 'coach';
  createdAt: Date;
  /** The last local day a short-term note matters. A note without one is long-term (DECISIONS #79). */
  until?: IsoDate;
  /** When the athlete last confirmed it; `createdAt` until they do. */
  reviewedAt?: Date;
  /** Soft delete, so a coach `forget` can be undone from the chat chip. */
  deletedAt?: Date;
}

export interface WorkoutDoc extends WorkoutInput {
  _id?: ObjectId;
  userId: string;
  source: 'seed' | 'coach' | 'manual' | 'import';
  createdAt: Date;
  archivedAt?: Date;
}

export interface CalendarEventDoc extends CalendarEventInput {
  _id?: ObjectId;
  userId: string;
  status: 'planned' | 'done' | 'skipped' | 'missed';
  source: 'coach' | 'manual' | 'intervals';
  /** Matched completed intervals.icu activity. */
  activityId?: string;
  proposalId?: string;
  /** The mirrored intervals.icu event (workouts and races). */
  intervals?: IntervalsLink;
  /** A push failed before any intervals.icu event existed; the next sync retries. */
  syncError?: string;
  /** Rides unlinked from this session; the matcher skips them. */
  ignoredActivityIds?: string[];
  /** Same-day rides the user grouped into this session, beside the primary `activityId`. */
  extraActivityIds?: string[];
  /** Its course (DECISIONS #99), in `courses`. Server-set only. */
  courseId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The athlete's rating of a ride. Keyed by the session it completed (`eventId`, with that
 * ride's `activityId` alongside) or, for an unplanned ride, by `activityId` alone. Date, title and
 * workout are copied in so range reads and the coach's feedback tool need no join. A missed or
 * skipped session's reason is the same doc with no `rpe` (DECISIONS #97).
 */
export interface SessionFeedbackDoc {
  _id?: ObjectId;
  userId: string;
  eventId?: string;
  activityId?: string;
  date: string;
  title: string;
  workoutId?: string;
  rpe?: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadDoc {
  _id?: ObjectId;
  userId: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date;
  /**
   * System prompt blocks frozen when the API context started: [persona, athlete, recap?]. Never
   * re-rendered within a context: changing them would invalidate the prompt cache and the replayed
   * thinking blocks. Profile and memory changes after this point reach the coach as appended context
   * messages instead. Only `restartContext` replaces them, for a new context (DECISIONS #80).
   */
  systemSnapshot: string[];
  /**
   * Each API context this thread has had, oldest first. The last is the one in use, and only messages
   * from its `startSeq` on are sent to Claude. Unset on threads from before contexts existed.
   */
  contexts?: ThreadContext[];
  /**
   * The calendar, time off, athlete and short-term note text the coach has already been shown in this context,
   * so per-turn context messages only repeat what changed (packages/coach/src/context.ts).
   */
  seen: { calendar?: string; athlete: string; extra?: string; shortTerm?: string; timeOff?: string; events?: string; outlook?: string };
  /** The next turn restarts with nothing older and no recap, and a new chat won't recap this one (DECISIONS #93). */
  forgetContext?: true;
  /** When a call last started on the build model, for the one warm follow-up (`warmFollowUp`). */
  lastBuildStartedAt?: Date;
  /** That one follow-up has been used, so the next turn goes back to the chat model. */
  buildFollowUpUsed?: boolean;
  /** A build started and hasn't written anything yet, so a retry starts on the build model. */
  buildPending?: boolean;
  /** `food` once the coach has suggested meals or built a recipe here. */
  tags?: ThreadTag[];
}

/** Why an API context began: a thread's first, a recap of the last chat, or a restart. */
export type ThreadContextReason = 'start' | 'carry' | RestartReason;

export interface ThreadContext {
  /** The first message of this context. */
  startSeq: number;
  at: Date;
  reason: ThreadContextReason;
  /** The tool definitions it began with: replayed thinking is only valid with the same ones. */
  toolsHash: string;
}

/** One API message, stored verbatim. `content` is an Anthropic content-block array. */
export interface MessageDoc {
  _id?: ObjectId;
  threadId: ObjectId;
  userId: string;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  /**
   * `user` = typed by the athlete; `context` = per-turn context we append (date, calendar, fitness,
   * changes); `tool_results` = tool results returned to the model; `assistant` = model output.
   */
  kind: 'user' | 'context' | 'tool_results' | 'assistant';
  content: unknown[];
  createdAt: Date;
  /** Chips and cards rendered from this message (tool_results only). Not sent to the API. */
  ui?: Exclude<UiBlock, { type: 'text' }>[];
  /** The model that wrote it (assistant messages). */
  model?: string;
}

/** The coach's outlook (DECISIONS #101): one per athlete. */
export interface CoachOutlookDoc {
  _id?: ObjectId;
  userId: string;
  text: string;
  source: 'coach' | 'user';
  updatedAt: Date;
}

/** An event's course (DECISIONS #99): the resampled track, and its analysis at `analysisVersion`. One per event. */
export interface CourseDoc {
  _id?: ObjectId;
  userId: string;
  /** The calendar session it belongs to. */
  eventId: string;
  name?: string;
  fileName?: string;
  points: CoursePoint[];
  analysis: CourseAnalysis;
  analysisVersion: number;
  createdAt: Date;
}

export interface TimeOffDoc extends TimeOffInput {
  _id?: ObjectId;
  userId: string;
  source: 'coach' | 'manual';
  proposalId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ProposalDoc = {
  _id?: ObjectId;
  userId: string;
  threadId: ObjectId;
  toolUseId: string;
  title: string;
  subtitle?: string;
  itemStatus: ProposalItemStatus[];
  createdAt: Date;
} & (
  | { kind: 'plan'; items: PlanItem[] }
  | { kind: 'calendar_changes'; items: ProposalChange[]; before?: (CalendarEvent | null)[] }
  | { kind: 'profile_update'; items: [ProfileUpdate] }
  | { kind: 'goal'; items: [GoalProposal] }
);

/**
 * Sync bookkeeping for intervals.icu and Zwift, per athlete. Credentials come from the integration
 * resolver's source (DECISIONS #53): env vars for the self-host owner; nothing secret is stored
 * here by the open-source app.
 */
export interface IntegrationDoc {
  _id?: ObjectId;
  userId: string;
  provider: 'intervals_icu' | 'zwift';
  /** Last successful sync; the next delta re-reads from this day (less a week). */
  lastSyncAt?: Date;
  /** When the last full import of all history finished (DECISIONS #49). */
  lastFullSyncAt?: Date;
  lastError?: string;
  /** The HTTP status behind `lastError`: a 401/403 means the key or token no longer works (DECISIONS #64). */
  lastErrorStatus?: number;
  /** intervals.icu's athlete record, refreshed at most hourly by the sync. */
  athlete?: { athleteId?: string; zwiftConnected?: boolean; ftp?: number; at: Date };
  /** intervals.icu said the athlete's settings changed: the next sync refreshes `athlete` regardless of its age. */
  athleteStale?: boolean;
  /** The athlete power curves (90d, season, 1y, all-time) as last fetched. */
  curves?: PowerCurve[];
  curvesAt?: Date;
  /** The full import's progress; it resumes from here after a restart or a rate limit. */
  fullSync?: FullSyncState;
  /** Zwift: this athlete's last "Get more events" walk; `lastAt` drives their 6 h cooldown. */
  extended?: { lastAt: Date; pages: number; events: number; through?: string; error?: string };
  updatedAt: Date;
}

/** `FullSyncProgress` plus the cursor that lets a full import pick up where it stopped. */
export interface FullSyncState extends FullSyncProgress {
  /** activities: the next quarter to list (its first day). wellness: the next year. */
  cursor?: string;
  /** Empty quarters in a row while walking back. */
  emptyRun?: number;
  /** First day of the oldest quarter with a ride. */
  oldest?: string;
}

/**
 * Rides from intervals.icu (DECISIONS #49), written only by the sync. intervals.icu stays the
 * source; this copy is what every screen and the coach read. `detailAt` is set once the detected
 * intervals are stored; a ride whose fingerprint changes is rewritten without them, so the sync
 * fetches them again.
 */
export interface ActivityDoc extends Activity {
  _id?: ObjectId;
  userId: string;
  fingerprint: string;
  intervals?: ActivityInterval[];
  detailAt?: Date;
  /** This ride's best power, fetched the first time the coach asks for it. */
  powerCurve?: PowerPoint[];
  syncedAt: Date;
}

/** One day of intervals.icu wellness: CTL/ATL, weigh-in, steps. Written only by the sync. */
export interface WellnessDoc extends WellnessDay {
  _id?: ObjectId;
  userId: string;
  syncedAt: Date;
}

/**
 * Zwift events, shared by every user (DECISIONS #29). Mongo's TTL monitor deletes each one once
 * `expiresAt` passes (its last pen's start + ride time + 2 h), so the collection never outgrows the
 * week ahead.
 */
export interface ZwiftEventDoc extends ZwiftEvent {
  _id?: ObjectId;
  syncedAt: Date;
  expiresAt: Date;
}

/** The athlete's sign-ups, read from the logged-in feed only, so the public sync can't clear them. */
export interface ZwiftEventMarkDoc {
  _id?: ObjectId;
  userId: string;
  eventId: number;
  signedUpPenIds: number[];
  expiresAt: Date;
}

/** Routes from Zwift's GameDictionary.xml; `routeId` = its `signature`. */
export interface ZwiftRouteDoc {
  _id?: ObjectId;
  routeId: number;
  name: string;
  world?: string;
  distanceM: number;
  ascentM: number;
  leadinM: number;
  leadinAscentM: number;
  syncedAt: Date;
}

export interface EventSearchDoc {
  _id?: ObjectId;
  userId: string;
  name: string;
  filters: EventFilters;
  createdAt: Date;
}

/**
 * Bookkeeping for jobs that aren't per user — the public events feed and the route table. One
 * document per job (`_id`). The per-athlete "Get more events" state is on their Zwift integration.
 */
export interface SyncStateDoc {
  _id: 'zwift_events';
  lastPublicSyncAt?: Date;
  lastPublicError?: string;
  lastRoutesAt?: Date;
  updatedAt: Date;
}

// ── Food module (DECISIONS #33) ─────────────────────────────────────────

export interface FoodDoc extends Omit<FoodInput, 'images'> {
  _id?: ObjectId;
  userId: string;
  images: (FoodImageRef & { createdAt: Date })[];
  /** Archived, never deleted: recipes, meals and the log keep pointing at it. */
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipeDoc extends RecipeInput {
  _id?: ObjectId;
  userId: string;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** A live, revocable public link to one recipe (DECISIONS #48). The token is the only key. */
export interface RecipeShareDoc {
  _id?: ObjectId;
  userId: string;
  recipeId: string;
  token: string;
  revokedAt?: Date;
  createdAt: Date;
}

export interface MealDoc extends MealInput {
  _id?: ObjectId;
  userId: string;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** One logged portion, with a nutrient snapshot — editing the food never rewrites history. */
export interface FoodLogDoc extends Omit<FoodLogEntry, 'id' | 'createdAt' | 'nutrients'> {
  _id?: ObjectId;
  userId: string;
  nutrients: Nutrients;
  createdAt: Date;
  updatedAt: Date;
}

export interface FoodSettingsDoc extends FoodSettings {
  _id?: ObjectId;
  userId: string;
  updatedAt: Date;
  /** When they finished or dismissed the food intro (DECISIONS #88). */
  introSeenAt?: Date;
}

/** BMR now; Phase 2 adds activity factor, goal and macro targets. */
export interface EnergySettingsDoc {
  _id?: ObjectId;
  userId: string;
  bmrKcal?: number;
  bmrSource?: BmrSource;
  bmrDate?: string;
  bmrNote?: string;
  activityMode?: 'steps' | 'factor';
  activityFactor?: number;
  exerciseSource?: 'power' | 'device';
  protectHardDays?: boolean;
  defaultKgPerWeek?: number;
  proteinGPerKg?: number;
  fatGPerKg?: number;
  updatedAt: Date;
}

/**
 * Canadian Nutrient File reference foods (staples search). Not per-user: imported once with
 * `pnpm food:import-cnf`; a staple only becomes one of the user's foods when they save it.
 */
export interface CnfFoodDoc {
  /** CNF food code. */
  _id: string;
  name: string;
  nameFr?: string;
  alt?: string;
  group?: string;
  per100g: Nutrients;
  portions: { label: string; grams: number }[];
  importedAt: Date;
}

export interface BodyScanDoc extends BodyScanInput {
  _id?: ObjectId;
  userId: string;
  createdAt: Date;
}

/** Meal idea cards from the coach — priced when made; a snapshot, never re-priced. */
export interface MealIdeasDoc {
  _id?: ObjectId;
  userId: string;
  threadId: ObjectId;
  toolUseId: string;
  slot: string;
  date: string;
  ideas: MealIdea[];
  followUps: string[];
  /** Ideas a recipe was built from. */
  picked: number[];
  kcalRange?: { min: number; max: number };
  createdAt: Date;
}

/**
 * A recipe the coach built, before (and after) the user saves it. Lines keep their match; totals are
 * priced on every read from their current foods. `recipeId` is set once it's a Library recipe.
 */
export interface RecipeDraftDoc {
  _id?: ObjectId;
  userId: string;
  threadId: ObjectId;
  toolUseId: string;
  ideasId?: string;
  ideaIndex?: number;
  name: string;
  description?: string;
  servings: number;
  minutes?: number;
  ingredients: (IngredientLine & { match: IngredientMatch | null })[];
  steps: string[];
  recipeId?: string;
  logged: RecipeDraftLog[];
  createdAt: Date;
  updatedAt: Date;
}

/** `toggle`: the athlete asked for it. `follow_up`: just after a build. `retry`: a build didn't finish. */
export type AiRouteStart = 'normal' | 'toggle' | 'follow_up' | 'retry';

export interface AiCallDoc {
  _id?: ObjectId;
  userId: string;
  threadId?: ObjectId;
  purpose: 'coach' | 'title' | 'recap' | 'food_parse' | 'food_vision' | 'food_match' | 'food_adjust' | 'food_estimate';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  stopReason?: string;
  /** The route that paid for it: `build` counts as the stronger model, whichever model served it. */
  tier?: 'chat' | 'build';
  /** The effort it ran at. Food calls have none. */
  effort?: string;
  /** The user message this call answered, so a turn's calls can be read together. */
  turnId?: string;
  /** Why the turn started where it did. */
  routeStart?: AiRouteStart;
  /** Output tokens were estimated, because the stream stopped before reporting them. */
  estimated?: boolean;
  createdAt: Date;
}

/**
 * A scheduled job, or a named lock (DECISIONS #56). One document per `kind:key` — the schedule and a
 * lease that works across processes: whoever holds `lockedBy` until `lockedUntil` runs it, and
 * nobody else does. A process that dies just lets its lease run out.
 */
export interface JobDoc {
  /** `${kind}:${key}`, e.g. `intervals.delta:<userId>`, `zwift.public:global`, `lock:zwift`. */
  _id: string;
  kind: string;
  key: string;
  /** Due from this time. Locks never fall due. */
  runAt: Date;
  /** A kick that may have landed during a run: that run's release keeps this if it's sooner (DECISIONS #64). */
  rerunAt?: Date;
  lockedBy?: string;
  lockedUntil?: Date;
  /** Failures in a row, for the backoff. */
  attempts: number;
  lastRunAt?: Date;
  lastError?: string;
  updatedAt: Date;
}

/** First-run onboarding (DECISIONS #62). No doc and no profile means it hasn't started. */
export interface OnboardingDoc {
  _id?: ObjectId;
  userId: string;
  step: number;
  fitness?: OnboardingFitness;
  unit?: 'kg' | 'lb';
  goals?: OnboardingGoals;
  /** The goals the wizard made, replaced when the Goals step is saved again. */
  goalIds: string[];
  rampTest?: { date: string; eventId: string };
  completedAt?: Date;
  updatedAt: Date;
}

/** Better Auth's `user` collection. Better Auth owns it; we only read the fields we show. */
export interface UserDoc {
  _id: ObjectId;
  email: string;
  name: string;
}

export function collections(db: Db) {
  return {
    users: db.collection<UserDoc>('user'),
    profiles: db.collection<ProfileDoc>('profiles'),
    powerBests: db.collection<PowerBestDoc>('power_bests'),
    goals: db.collection<GoalDoc>('goals'),
    memories: db.collection<MemoryDoc>('memories'),
    workouts: db.collection<WorkoutDoc>('workouts'),
    calendarEvents: db.collection<CalendarEventDoc>('calendar_events'),
    timeOff: db.collection<TimeOffDoc>('time_off'),
    courses: db.collection<CourseDoc>('courses'),
    coachOutlook: db.collection<CoachOutlookDoc>('coach_outlook'),
    threads: db.collection<ThreadDoc>('threads'),
    messages: db.collection<MessageDoc>('messages'),
    proposals: db.collection<ProposalDoc>('proposals'),
    integrations: db.collection<IntegrationDoc>('integrations'),
    aiCalls: db.collection<AiCallDoc>('ai_calls'),
    zwiftEvents: db.collection<ZwiftEventDoc>('zwift_events'),
    zwiftEventMarks: db.collection<ZwiftEventMarkDoc>('zwift_event_marks'),
    zwiftRoutes: db.collection<ZwiftRouteDoc>('zwift_routes'),
    eventSearches: db.collection<EventSearchDoc>('event_searches'),
    sessionFeedback: db.collection<SessionFeedbackDoc>('session_feedback'),
    syncState: db.collection<SyncStateDoc>('sync_state'),
    foods: db.collection<FoodDoc>('foods'),
    recipes: db.collection<RecipeDoc>('recipes'),
    meals: db.collection<MealDoc>('meals'),
    foodLog: db.collection<FoodLogDoc>('food_log'),
    foodSettings: db.collection<FoodSettingsDoc>('food_settings'),
    energySettings: db.collection<EnergySettingsDoc>('energy_settings'),
    bodyScans: db.collection<BodyScanDoc>('body_scans'),
    cnfFoods: db.collection<CnfFoodDoc>('cnf_foods'),
    mealIdeas: db.collection<MealIdeasDoc>('meal_ideas'),
    recipeDrafts: db.collection<RecipeDraftDoc>('recipe_drafts'),
    recipeShares: db.collection<RecipeShareDoc>('recipe_shares'),
    activities: db.collection<ActivityDoc>('activities'),
    wellness: db.collection<WellnessDoc>('wellness'),
    jobs: db.collection<JobDoc>('jobs'),
    onboarding: db.collection<OnboardingDoc>('onboarding'),
  };
}

export type Collections = ReturnType<typeof collections>;
export type { Collection };

export async function ensureIndexes(db: Db): Promise<void> {
  const c = collections(db);
  await Promise.all([
    c.profiles.createIndex({ userId: 1 }, { unique: true }),
    c.powerBests.createIndex({ userId: 1, period: 1, durationSec: 1 }, { unique: true }),
    c.goals.createIndex({ userId: 1 }),
    c.memories.createIndex({ userId: 1, createdAt: 1 }),
    c.workouts.createIndex({ userId: 1, createdAt: -1 }),
    c.calendarEvents.createIndex({ userId: 1, date: 1 }),
    c.timeOff.createIndex({ userId: 1, startDate: 1 }),
    c.courses.createIndex({ userId: 1, eventId: 1 }, { unique: true }),
    c.coachOutlook.createIndex({ userId: 1 }, { unique: true }),
    c.calendarEvents.createIndex({ userId: 1, 'intervals.eventId': 1 }, { sparse: true }),
    c.threads.createIndex({ userId: 1, lastMessageAt: -1 }),
    c.messages.createIndex({ threadId: 1, seq: 1 }, { unique: true }),
    c.proposals.createIndex({ threadId: 1 }),
    c.messages.createIndex({ userId: 1 }),
    c.proposals.createIndex({ userId: 1 }),
    c.integrations.createIndex({ userId: 1, provider: 1 }, { unique: true }),
    c.aiCalls.createIndex({ userId: 1, createdAt: -1 }),
    c.aiCalls.createIndex({ createdAt: -1 }),
    c.calendarEvents.createIndex({ userId: 1, zwiftEventId: 1 }, { sparse: true }),
    c.zwiftEvents.createIndex({ id: 1 }, { unique: true }),
    c.zwiftEvents.createIndex({ start: 1 }),
    c.zwiftEvents.createIndex({ type: 1, start: 1 }),
    c.zwiftEvents.createIndex({ signedUp: -1 }),
    c.zwiftEvents.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.zwiftEventMarks.createIndex({ userId: 1, eventId: 1 }, { unique: true }),
    c.zwiftEventMarks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.zwiftRoutes.createIndex({ routeId: 1 }, { unique: true }),
    c.eventSearches.createIndex({ userId: 1, createdAt: 1 }),
    c.sessionFeedback.createIndex({ userId: 1, eventId: 1 }, { unique: true, partialFilterExpression: { eventId: { $exists: true } } }),
    c.sessionFeedback.createIndex({ userId: 1, activityId: 1 }, { unique: true, partialFilterExpression: { activityId: { $exists: true } } }),
    c.sessionFeedback.createIndex({ userId: 1, date: -1 }),
    c.foods.createIndex({ userId: 1, archivedAt: 1 }),
    c.foods.createIndex({ userId: 1, barcodes: 1 }),
    c.recipes.createIndex({ userId: 1 }),
    c.meals.createIndex({ userId: 1 }),
    c.foodLog.createIndex({ userId: 1, date: 1, createdAt: 1 }),
    c.foodLog.createIndex({ userId: 1, kind: 1, refId: 1 }),
    c.foodSettings.createIndex({ userId: 1 }, { unique: true }),
    c.energySettings.createIndex({ userId: 1 }, { unique: true }),
    c.bodyScans.createIndex({ userId: 1, date: -1 }),
    c.mealIdeas.createIndex({ userId: 1, threadId: 1 }),
    c.recipeDrafts.createIndex({ userId: 1, threadId: 1 }),
    c.recipeShares.createIndex({ token: 1 }, { unique: true }),
    c.recipeShares.createIndex({ userId: 1, recipeId: 1 }),
    c.activities.createIndex({ userId: 1, id: 1 }, { unique: true }),
    c.activities.createIndex({ userId: 1, startLocal: -1 }),
    c.activities.createIndex({ userId: 1, detailAt: 1, startLocal: -1 }),
    c.wellness.createIndex({ userId: 1, date: 1 }, { unique: true }),
    c.jobs.createIndex({ kind: 1, runAt: 1 }),
    c.onboarding.createIndex({ userId: 1 }, { unique: true }),
  ]);
}
