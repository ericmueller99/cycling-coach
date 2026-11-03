import { CoachEngine, FoodAi } from '@cycling-coach/coach';
import {
  aiSpendSince,
  archiveWorkout,
  collections,
  type Collections,
  createGoal,
  createMemory,
  createMongo,
  deleteGoal,
  getEvent,
  ensureIndexes,
  forgetMemory,
  getProfile,
  getProposalDoc,
  getWorkout,
  listEvents,
  listFeedback,
  listGoals,
  listMemories,
  listPowerBests,
  listThreads,
  listWorkouts,
  migrate,
  getUserName,
  ownerUserId,
  restoreMemory,
  saveProfile,
  savePowerBest,
  toProposal,
  updateGoal,
  updateMemory,
  createEventSearch,
  deleteEventSearch,
  listEventSearches,
} from '@cycling-coach/db';
import { sessionRideIds, todayIn } from '@cycling-coach/core';
import type { IntegrationStatus, ZwiftStatus } from '@cycling-coach/shared';
import type { Db } from 'mongodb';
import { createApp, type AppServices } from './app';
import { authConfig, createAuth, type Auth, type AuthExtension } from './auth';
import type { Env } from './lib/env';
import { allowSpend, type SpendGuard } from './lib/spend';
import { envCredentials, envFeatures, IntegrationResolver, memoOwner, type CredentialSource, type FeatureSource } from './integrations';
import { ensureJobs, ensureUserJobs, JOB, JobRunner, registerJobs, type JobDeps } from './jobs';
import { buildDashboard, withProgress } from './services/athlete';
import { CalendarService } from './services/calendar';
import { EnergyService } from './services/energy';
import { FeedbackService } from './services/feedback';
import { FoodService } from './services/food';
import { RecipeShareService } from './services/recipe-share';
import { StaplesService } from './services/food-staples';
import { FoodAiService } from './services/food-ai';
import { OpenFoodFacts } from './providers/openfoodfacts';
import { photoStoreFromEnv } from './providers/storage/s3';
import { UsdaClient } from './providers/usda';
import { getThreadView, sendMessage, startThread, type CoachDeps } from './services/coach';
import { CoachFoodService } from './services/coach-food';
import { IntervalsSync } from './services/intervals-sync';
import { TrainingData } from './services/training-data';
import { weightHistory } from './services/weight';
import { ZwiftSync } from './services/zwift-sync';
import { ZwiftPublic } from './providers/zwift';
import { ZwiftEventsService } from './services/zwift-events';
import { applyProposal, dismissProposal } from './services/proposals';
import { OnboardingService } from './services/onboarding';

/** What `createCore` hands the credential and feature factories. */
export interface CoreContext {
  c: Collections;
  /** The database itself, for a deployment's own collections (DECISIONS #60). */
  db: Db;
  env: Env;
  /** The self-host owner (OWNER_EMAIL, else the oldest account); the hosted version ignores it. */
  ownerId: () => Promise<string | null>;
}

/**
 * The seams a deployment plugs into (DECISIONS #57). Every one has a self-host default, so the
 * open-source server passes only `env`.
 */
export interface CoreOptions {
  env: Env;
  /** Per-athlete integration credentials. Default: the env vars, for the owner account only (#53). */
  credentials?: (ctx: CoreContext) => CredentialSource;
  /** What each account may use. Default: everything for the owner (#54). */
  features?: (ctx: CoreContext) => FeatureSource;
  /** Better Auth additions: open sign-up, plugins (verification, reset), options. */
  auth?: AuthExtension;
  /** Asked before every Claude call. Default: never refuses. */
  spendGuard?: SpendGuard;
  /**
   * Appended to workout names pushed to intervals.icu, e.g. " via example.com". Zwift titles the ride
   * after the workout, so it shows wherever the ride is shared. Stripped from names read back.
   * Default: none (DECISIONS #63).
   */
  eventNameSuffix?: string;
  now?: () => Date;
}

export interface Core {
  env: Env;
  c: Collections;
  db: Db;
  auth: Auth;
  /** The API (no SPA): mount more routes beside it, then serve it. */
  app: ReturnType<typeof createApp>;
  services: AppServices;
  integrations: IntegrationResolver;
  jobs: JobRunner;
  /** Create any missing jobs and run the job loop in this process (DECISIONS #56). */
  startJobs(): Promise<void>;
  /**
   * After a user's credentials were stored, changed or removed (DECISIONS #60): drop their cached
   * clients here, schedule or remove their jobs, and sync intervals.icu now when it's connected (a
   * first sync starts the full import). Works from any process — jobs are database documents.
   */
  credentialsChanged(userId: string): Promise<{ intervals: boolean; zwift: boolean }>;
  /** Hand back job leases and close the database. */
  close(): Promise<void>;
}

/** Self-host: INTERVALS_ICU_KEY and ZWIFT_* belong to the owner account. */
function selfHostCredentials({ env, ownerId }: CoreContext): CredentialSource {
  return envCredentials({
    intervalsKey: env.INTERVALS_ICU_KEY,
    intervalsAthleteId: env.INTERVALS_ICU_ATHLETE_ID,
    zwiftUsername: env.ZWIFT_USERNAME,
    zwiftPassword: env.ZWIFT_PASSWORD,
    ownerId,
  });
}

/**
 * The composition root (DECISIONS #57): connects the database, builds auth, integrations, services,
 * the job schedule and the API. `server.ts` (HTTP + SPA) and `worker.ts` (jobs only) are thin
 * callers, and the hosted version calls it with its own credentials, features, auth and spend guard.
 *
 * Optional integrations degrade instead of crashing the boot: without a Claude key the coach says
 * it's offline; an athlete without intervals.icu has no training data and their syncs answer 503.
 * Integration clients are per athlete (#53), and every Zwift request shares one gate and one
 * cross-process lock (#29, #56).
 */
export async function createCore(opts: CoreOptions): Promise<Core> {
  const env = opts.env;
  const now = opts.now ?? (() => new Date());
  const spendGuard = opts.spendGuard ?? allowSpend;

  const mongo = createMongo(env.MONGO_DB_URI, env.MONGO_DB_NAME);
  await mongo.client.connect();
  await ensureIndexes(mongo.db);
  await migrate(mongo.db);
  const c = collections(mongo.db);
  const auth = createAuth(mongo, env, opts.auth);

  /**
   * Optional integrations degrade instead of crashing the boot: without a Claude key the coach says
   * it's offline; an athlete without intervals.icu has no training data and their syncs answer 503.
   *
   * Integration clients are per athlete (DECISIONS #53). Self-host: the env credentials belong to the
   * owner account (OWNER_EMAIL, else the oldest account) and nobody else. Every Zwift request — the
   * zFTP sync, the public feed, "Get more events", the route table — shares the resolver's one Zwift
   * gate: one at a time, 2 s apart (DECISIONS #29).
   */
  const ownerId = memoOwner(() => ownerUserId(c, env.OWNER_EMAIL));
  const ctx: CoreContext = { c, db: mongo.db, env, ownerId };
  const integrations = new IntegrationResolver(opts.credentials ? opts.credentials(ctx) : selfHostCredentials(ctx));
  const features = opts.features ? opts.features(ctx) : envFeatures(ownerId);
  if (!opts.credentials) {
    if (!env.INTERVALS_ICU_KEY) console.warn('INTERVALS_ICU_KEY not set — no training data; the coach will say so.');
    if (!env.ZWIFT_USERNAME || !env.ZWIFT_PASSWORD) console.warn('ZWIFT_USERNAME/ZWIFT_PASSWORD not set — zFTP is entered by hand.');
  }

  const engine = env.CLAUDE_API_KEY
    ? new CoachEngine({ apiKey: env.CLAUDE_API_KEY, model: env.CLAUDE_MODEL, effort: env.CLAUDE_EFFORT })
    : null;
  if (!engine) console.warn('CLAUDE_API_KEY not set — the coach will report itself offline.');


  /** Shown as the .zwo author in Zwift. */
  const authorName = async (userId: string) => (await getUserName(c, userId)) || 'Cycling Coach';

  /** Rides, wellness and curves as synced from intervals.icu (DECISIONS #49) — what every screen reads. */
  const training = new TrainingData(c, integrations, now);
  const calendar = new CalendarService(c, integrations, authorName, now, opts.eventNameSuffix);
  const feedback = new FeedbackService(c, training, now);
  const onboarding = new OnboardingService(c, calendar, now);
  const food = new FoodService(c, now);
  const recipeShares = new RecipeShareService(c, env.APP_URL, now);
  const energy = new EnergyService(c, training, now);
  /** USDA works without a key on its shared DEMO_KEY (30 requests an hour) — enough for the odd staple. */
  const staples = new StaplesService(c, new UsdaClient(env.USDA_FDC_API_KEY || 'DEMO_KEY'), now);
  /** Labels and logging phrases go to a small model (FOOD_AI_MODEL), never the coach's Opus. */
  const foodAi = new FoodAiService(
    c,
    env.CLAUDE_API_KEY ? new FoodAi({ apiKey: env.CLAUDE_API_KEY, model: env.FOOD_AI_MODEL }) : null,
    photoStoreFromEnv(env),
    new OpenFoodFacts(),
    (userId) => food.library(userId),
    async (userId) => (await getProfile(c, userId))?.timezone ?? 'UTC',
    now,
    spendGuard,
  );
  if (!photoStoreFromEnv(env)) console.warn('S3_* not set — food label photos are read but not kept.');
  void staples.imported().then((n) => {
    if (!n) console.warn('Canadian Nutrient File not imported — staples search is empty. Run: pnpm food:import-cnf');
  });
  /** The job schedule and the cross-process locks (DECISIONS #56). Registered below, started at the end. */
  const jobs = new JobRunner(c, { concurrency: env.JOBS_CONCURRENCY, now });
  /** Every Zwift caller holds this, so only one process ever talks to Zwift at a time. */
  const zwiftLock = <T>(fn: () => Promise<T>) => jobs.withLock('zwift', fn);
  const sync = new IntervalsSync(
    c,
    integrations,
    calendar,
    { full: (userId) => jobs.trigger(JOB.full, userId), delta: (userId) => jobs.trigger(JOB.delta, userId) },
    now,
  );
  const zwiftSync = new ZwiftSync(c, integrations, zwiftLock);
  const zwiftEvents = new ZwiftEventsService(c, new ZwiftPublic({ gate: integrations.zwiftGate }), integrations, now, {}, undefined, zwiftLock);
  const jobDeps: JobDeps = { c, sync, zwiftSync, zwiftEvents, now };
  registerJobs(jobs, jobDeps);
  const coachFood = new CoachFoodService(
    c,
    food,
    { searchStaples: (q, source) => staples.search(q, source), stapleDetail: (source, ref) => staples.detail(source, ref) },
    env.CLAUDE_API_KEY ? new FoodAi({ apiKey: env.CLAUDE_API_KEY, model: env.FOOD_AI_MODEL }) : null,
    now,
  );
  const coach: CoachDeps = {
    c,
    engine,
    training,
    intervalsConnected: (userId) => sync.connected(userId),
    events: zwiftEvents,
    spendGuard,
    food: { food, energy, coachFood },
    now,
  };

  /** Today's CTL for fitness goals, from the synced wellness. */
  async function ctlToday(userId: string, timezone: string) {
    return (await training.fitnessOn(userId, todayIn(timezone, now())))?.ctl;
  }

  const startOfMonthUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

  /** intervals.icu status from our sync bookkeeping — no live call (DECISIONS #49). */
  const intervalsStatus = (userId: string): Promise<IntegrationStatus> => sync.status(userId);

  const services: AppServices = {
    features: (userId) => features.forUser(userId),

    onboarding: {
      onboarded: (userId) => onboarding.onboarded(userId),
      state: (userId) => onboarding.state(userId),
      saveFitness: (userId, input) => onboarding.saveFitness(userId, input),
      saveBody: (userId, input) => onboarding.saveBody(userId, input),
      saveGoals: (userId, input) => onboarding.saveGoals(userId, input),
      setStep: (userId, step) => onboarding.setStep(userId, step),
      finish: (userId) => onboarding.finish(userId),
    },

    dashboard: async (userId) => {
      const status = await intervalsStatus(userId);
      return buildDashboard(
        c,
        userId,
        status,
        async (date) => (await training.fitnessOn(userId, date).catch(() => undefined)) ?? undefined,
        now(),
      );
    },

    usage: async (userId) => {
      const spend = await aiSpendSince(c, userId, startOfMonthUtc(now()));
      return { monthToDateUsd: spend.costUsd, calls: spend.calls, model: env.CLAUDE_MODEL };
    },

    profile: {
      get: async (userId) => {
        const profile = await getProfile(c, userId);
        if (!profile) return null;
        const [powerBests, goals, memories, ctl] = await Promise.all([
          listPowerBests(c, userId),
          listGoals(c, userId),
          listMemories(c, userId),
          ctlToday(userId, profile.timezone),
        ]);
        return { profile, powerBests, goals: withProgress(goals, profile, powerBests, ctl), memories };
      },
      save: async (userId, profile) => {
        // A synced weight belongs to intervals.icu; the form can't overwrite it.
        const current = await getProfile(c, userId);
        const synced = current?.weightSource === 'intervals.icu';
        await saveProfile(
          c,
          userId,
          synced
            ? { ...profile, weightKg: current.weightKg, weightSource: 'intervals.icu', ...(current.weightLatest ? { weightLatest: current.weightLatest } : {}) }
            : { ...profile, weightSource: 'manual' },
          now(),
        );
      },
      savePowerBests: async (userId, bests) => {
        for (const b of bests) await savePowerBest(c, userId, b, now());
      },
    },

    weight: {
      // From the synced wellness; no history is an empty chart.
      history: async (userId) => {
        const profile = await getProfile(c, userId);
        if (!profile) return { points: [] };
        return weightHistory(training, userId, todayIn(profile.timezone, now()));
      },
    },

    goals: {
      create: (userId, input) => createGoal(c, userId, input, now()),
      update: (userId, id, input) => updateGoal(c, userId, id, input),
      remove: (userId, id) => deleteGoal(c, userId, id),
    },

    memories: {
      create: (userId, text) => createMemory(c, userId, text, 'user', now()),
      update: (userId, id, text) => updateMemory(c, userId, id, text),
      remove: (userId, id) => forgetMemory(c, userId, id, now()),
      restore: (userId, id) => restoreMemory(c, userId, id),
    },

    workouts: {
      list: (userId) => listWorkouts(c, userId),
      get: (userId, id) => getWorkout(c, userId, id),
      archive: (userId, id) => archiveWorkout(c, userId, id, now()),
    },

    calendar: {
      list: async (userId, from, to) => {
        const [events, ratings] = await Promise.all([listEvents(c, userId, from, to), listFeedback(c, userId, { from, to })]);
        const rides = await training.activities(userId, from, to);
        const completedBy = new Map(events.flatMap((e) => sessionRideIds(e).map((rideId) => [rideId, e.id] as const)));
        return { events, activities: rides.map((a) => ({ ...a, matchedEventId: completedBy.get(a.id) })), feedback: ratings };
      },
      create: (userId, input) => calendar.create(userId, input, { source: 'manual' }),
      patch: (userId, id, patch) => calendar.patch(userId, id, patch),
      remove: (userId, id) => calendar.remove(userId, id),
      resync: async (userId, id) => {
        const event = await getEvent(c, userId, id);
        return event ? calendar.push(userId, event) : null;
      },
      unlinkRide: (userId, id) => calendar.unlinkRide(userId, id),
      addRide: (userId, id, activityId) => calendar.addRide(userId, id, activityId),
      removeRide: (userId, id, activityId) => calendar.removeRide(userId, id, activityId),
      result: (userId, id) => feedback.result(userId, id),
    },

    feedback: {
      save: (userId, input) => feedback.save(userId, input),
    },

    threads: {
      list: (userId) => listThreads(c, userId),
      create: (userId) => startThread(coach, userId),
      view: (userId, id) => getThreadView(coach, userId, id),
      send: (userId, id, input, signal) => sendMessage(coach, userId, id, input, signal),
    },

    public: {
      recipe: (token) => recipeShares.publicView(token),
    },

    coachFood: {
      ideas: (userId, id) => coachFood.ideas(userId, id),
      fixIdeaIngredient: (userId, id, fix) => coachFood.fixIdeaIngredient(userId, id, fix),
      get: (userId, id) => coachFood.get(userId, id),
      patch: (userId, id, patch) => coachFood.patch(userId, id, patch),
      save: (userId, id) => coachFood.save(userId, id),
      log: (userId, id, input) => coachFood.log(userId, id, input),
    },

    proposals: {
      get: async (userId, id) => {
        const doc = await getProposalDoc(c, userId, id);
        return doc ? toProposal(doc) : null;
      },
      apply: (userId, id, indexes) => applyProposal(c, calendar, userId, id, indexes, now()),
      dismiss: (userId, id, indexes) => dismissProposal(c, userId, id, indexes),
    },

    intervals: {
      status: intervalsStatus,
      // "Sync now" holds the athlete's delta-job lease: never beside a scheduled run in any process.
      sync: (userId) => jobs.runNow(JOB.delta, userId, () => sync.run(userId)),
      fullSync: (userId) => sync.startFullSync(userId),
    },

    events: {
      status: (userId) => zwiftEvents.status(userId),
      query: (userId, query) => zwiftEvents.query(userId, query),
      refresh: () => zwiftEvents.syncPublic(),
      extend: (userId) => zwiftEvents.extend(userId),
      searches: {
        list: (userId) => listEventSearches(c, userId),
        create: (userId, input) => createEventSearch(c, userId, input, now()),
        remove: (userId, id) => deleteEventSearch(c, userId, id),
      },
    },

    food: {
      library: (userId) => food.library(userId),
      createFood: (userId, input) => food.createFood(userId, input),
      updateFood: (userId, id, patch) => food.updateFood(userId, id, patch),
      archiveFood: (userId, id) => food.archiveFood(userId, id),
      createRecipe: (userId, input) => food.createRecipe(userId, input),
      updateRecipe: (userId, id, patch) => food.updateRecipe(userId, id, patch),
      archiveRecipe: (userId, id) => food.archiveRecipe(userId, id),
      recipe: (userId, id) => recipeShares.detail(userId, id),
      shareRecipe: (userId, id) => recipeShares.share(userId, id),
      unshareRecipe: (userId, id) => recipeShares.unshare(userId, id),
      createMeal: (userId, input) => food.createMeal(userId, input),
      updateMeal: (userId, id, patch) => food.updateMeal(userId, id, patch),
      archiveMeal: (userId, id) => food.archiveMeal(userId, id),
      listLog: (userId, from, to) => food.listLog(userId, from, to),
      log: (userId, entries) => food.log(userId, entries),
      patchEntry: (userId, id, patch) => food.patchEntry(userId, id, patch),
      deleteEntry: (userId, id) => food.deleteEntry(userId, id),
      copyEntry: (userId, id, to) => food.copyEntry(userId, id, to),
      saveSettings: (userId, settings) => food.saveSettings(userId, settings),
      searchStaples: (q, source) => staples.search(q, source),
      stapleDetail: (source, ref) => staples.detail(source, ref),
      readPhoto: (userId, input) => foodAi.readPhoto(userId, input),
      barcode: (userId, code) => foodAi.barcode(userId, code),
      imageUrls: (userId, id) => foodAi.imageUrls(userId, id),
      parse: (userId, input) => foodAi.parse(userId, input),
    },

    energy: {
      get: (userId) => energy.get(userId),
      patch: (userId, patch) => energy.patch(userId, patch),
      addScan: (userId, input) => energy.addScan(userId, input),
      updateScan: (userId, id, patch) => energy.updateScan(userId, id, patch),
      deleteScan: (userId, id) => energy.deleteScan(userId, id),
      budget: (userId, date) => energy.budget(userId, date),
      days: (userId, from, to) => energy.days(userId, from, to),
    },

    zwift: {
      status: (userId) => zwiftSync.status(userId),
      sync: async (userId): Promise<ZwiftStatus> => {
        // The failure is recorded and reported by status().
        await jobs.runNow(JOB.zwiftMetrics, userId, () => zwiftSync.run(userId, now(), { manual: true })).catch(() => {});
        return zwiftSync.status(userId);
      },
    },
  };

  const app = createApp({ auth, authConfig: authConfig(opts.auth), env, services });

  return {
    env,
    c,
    db: mongo.db,
    auth,
    app,
    services,
    integrations,
    jobs,
    startJobs: async () => {
      await ensureJobs(jobs, jobDeps).catch((err: Error) => console.warn('jobs: ensure failed —', err.message));
      jobs.start();
    },
    credentialsChanged: async (userId) => {
      integrations.invalidate(userId);
      const connected = await ensureUserJobs(jobs, jobDeps, userId);
      if (connected.intervals) await jobs.kick(JOB.delta, userId);
      return connected;
    },
    close: async () => {
      // Hand back leases so another process can pick the jobs up at once.
      await jobs.stop().catch(() => {});
      await mongo.client.close();
    },
  };
}

export type { CredentialSource, FeatureSource, IntegrationResolver } from './integrations';
export type { AuthExtension } from './auth';
export type { AiUse, SpendGuard } from './lib/spend';
export { JobRunner } from './jobs';
export { serveSpa } from './lib/spa';
export { loadEnv, webOrigins, type Env } from './lib/env';
