import { buildZwo, zwoFileName } from '@cycling-coach/core';
import {
  calendarEventInputSchema,
  calendarEventPatchSchema,
  sessionRideInputSchema,
  calendarRangeQuerySchema,
  timeOffInputSchema,
  timeOffPatchSchema,
  eventQuerySchema,
  goalInputSchema,
  goalPatchSchema,
  memoryInputSchema,
  memoryPatchSchema,
  memoryRevertSchema,
  powerBestSchema,
  profileSchema,
  savedSearchInputSchema,
  recipeDraftLogSchema,
  mealIdeaFixSchema,
  recipeDraftPatchSchema,
  sendMessageSchema,
  sessionFeedbackInputSchema,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarPayload,
  type CalendarEventPatch,
  type CoachEvent,
  type DashboardPayload,
  type EventQuery,
  type EventQueryResult,
  type EventsExtendResult,
  type EventsRefreshResult,
  type EventsStatus,
  type Goal,
  type GoalInput,
  type GoalPatch,
  type IsoDate,
  type MealIdeaFix,
  type MealIdeas,
  type Memory,
  type MemoryInput,
  type MemoryPatch,
  type MemoryRevert,
  type MemoryUpdate,
  type PowerBest,
  type Profile,
  type FullSyncProgress,
  type IntegrationStatus,
  type ProfilePayload,
  type Proposal,
  type RecipeDraft,
  type RecipeDraftLogInput,
  type RecipeDraftPatch,
  type SavedSearch,
  type SendMessageInput,
  type SavedSearchInput,
  type SessionFeedback,
  type SessionFeedbackInput,
  type SessionResult,
  type ThreadSummary,
  type ThreadView,
  type UsagePayload,
  type WeightHistoryPayload,
  type Workout,
  type ZwiftStatus,
  type Features,
  type AuthConfig,
  onboardingBodySchema,
  onboardingFitnessSchema,
  onboardingGoalsSchema,
  onboardingStepSchema,
  type OnboardingBody,
  type OnboardingFitness,
  type OnboardingGoals,
  type OnboardingState,
  type TimeOff,
  type TimeOffInput,
  type TimeOffPatch,
  type TurnStop,
  THREAD_LIST_MAX,
  threadListQuerySchema,
} from '@cycling-coach/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Auth } from './auth';
import { type Env, webOrigins } from './lib/env';
import { json, query } from './lib/validate';
import { energyRoutes, foodRoutes, type EnergyServices, type FoodServices } from './routes/food';
import { publicRoutes, type PublicServices } from './routes/public';

/**
 * What the routes need, as a narrow port. Injected rather than imported so this module stays free
 * of Node-only code: the SPA typechecks against the router type exported below, and pulling in
 * the Mongo driver or `node:crypto` here would drag Node types into the browser build (the
 * ai-budget lesson). Implementations are wired in `server.ts`.
 */
export interface AppServices {
  /** What this account may use (DECISIONS #54); sent with `/api/me`. */
  features(userId: string): Promise<Features>;
  /** First-run onboarding (DECISIONS #62); `onboarded` is sent with `/api/me`. */
  onboarding: {
    onboarded(userId: string): Promise<boolean>;
    state(userId: string): Promise<OnboardingState>;
    saveFitness(userId: string, input: OnboardingFitness): Promise<OnboardingState>;
    saveBody(userId: string, input: OnboardingBody): Promise<OnboardingState>;
    saveGoals(userId: string, input: OnboardingGoals): Promise<OnboardingState>;
    setStep(userId: string, step: number): Promise<OnboardingState>;
    finish(userId: string): Promise<OnboardingState | ServiceFailure>;
  };
  dashboard(userId: string): Promise<DashboardPayload | null>;
  usage(userId: string): Promise<UsagePayload>;
  profile: {
    get(userId: string): Promise<ProfilePayload | null>;
    save(userId: string, profile: Profile): Promise<void>;
    savePowerBests(userId: string, bests: PowerBest[]): Promise<void>;
  };
  weight: {
    /** The last 90 days of weigh-ins with their trend; empty when intervals.icu is off or failing. */
    history(userId: string): Promise<WeightHistoryPayload>;
  };
  goals: {
    create(userId: string, input: GoalInput): Promise<Goal>;
    update(userId: string, id: string, input: GoalPatch): Promise<Goal | null>;
    remove(userId: string, id: string): Promise<boolean>;
  };
  memories: {
    create(userId: string, input: MemoryInput): Promise<Memory | { error: string }>;
    update(userId: string, id: string, patch: MemoryPatch): Promise<MemoryUpdate | { error: string } | null>;
    remove(userId: string, id: string): Promise<Memory | null>;
    restore(userId: string, id: string): Promise<Memory | null>;
    review(userId: string, id: string): Promise<Memory | null>;
    revert(userId: string, id: string, input: MemoryRevert): Promise<Memory | null>;
  };
  workouts: {
    list(userId: string): Promise<Workout[]>;
    get(userId: string, id: string): Promise<Workout | null>;
    archive(userId: string, id: string): Promise<boolean>;
  };
  calendar: {
    /** Planned sessions plus every synced ride in the range. */
    list(userId: string, from: IsoDate, to: IsoDate): Promise<CalendarPayload>;
    create(userId: string, input: CalendarEventInput): Promise<CalendarEvent>;
    /** `syncError` is set when the change couldn't be pushed to intervals.icu (it's retried). */
    patch(userId: string, id: string, patch: CalendarEventPatch): Promise<{ event: CalendarEvent; syncError?: string } | null>;
    /** `error` when intervals.icu refused the delete — the session is kept so it can't reappear. */
    remove(userId: string, id: string): Promise<{ ok: true } | { error: string } | null>;
    /** Retry a failed push to intervals.icu. */
    resync(userId: string, id: string): Promise<CalendarEvent | null>;
    /** Unpair a session from its matched ride for good (local only). */
    unlinkRide(userId: string, id: string): Promise<CalendarEvent | { error: string } | null>;
    /** Group a same-day ride into a session, or take one out (DECISIONS #32; local only). */
    addRide(userId: string, id: string, activityId: string): Promise<CalendarEvent | ServiceFailure | null>;
    removeRide(userId: string, id: string, activityId: string): Promise<CalendarEvent | ServiceFailure | null>;
    /** The session's rides and its reps against the plan, from the synced rides. */
    result(userId: string, id: string): Promise<SessionResult | ServiceFailure>;
  };
  /** Ride ratings (RPE + note). Stored only; the coach reads them in chat. */
  timeOff: {
    list(userId: string, from: IsoDate, to: IsoDate): Promise<TimeOff[]>;
    create(userId: string, input: TimeOffInput): Promise<TimeOff>;
    patch(userId: string, id: string, patch: TimeOffPatch): Promise<TimeOff | ServiceFailure | null>;
    remove(userId: string, id: string): Promise<boolean>;
  };
  feedback: {
    save(userId: string, input: SessionFeedbackInput): Promise<SessionFeedback | { cleared: true } | ServiceFailure>;
  };
  threads: {
    /** Why a coach turn would be refused right now, or null. */
    check(userId: string): Promise<TurnStop | null>;
    list(userId: string, limit?: number): Promise<ThreadSummary[]>;
    create(userId: string): Promise<ThreadSummary | null>;
    view(userId: string, id: string): Promise<ThreadView | null>;
    send(userId: string, id: string, input: SendMessageInput, signal: AbortSignal): AsyncIterable<CoachEvent>;
  };
  /** Readable without signing in: recipe share links (DECISIONS #48). */
  public: PublicServices;
  /** Meal ideas and recipes from Coach chat. Save / log are the user's clicks. */
  coachFood: {
    ideas(userId: string, id: string): Promise<MealIdeas | null>;
    /** Pick a match for an unmatched ingredient in the Details pane. */
    fixIdeaIngredient(userId: string, id: string, fix: MealIdeaFix): Promise<MealIdeas | ServiceFailure>;
    get(userId: string, id: string): Promise<RecipeDraft | null>;
    patch(userId: string, id: string, patch: RecipeDraftPatch): Promise<RecipeDraft | ServiceFailure>;
    save(userId: string, id: string): Promise<RecipeDraft | ServiceFailure>;
    log(userId: string, id: string, input: RecipeDraftLogInput): Promise<RecipeDraft | ServiceFailure>;
  };
  proposals: {
    get(userId: string, id: string): Promise<Proposal | null>;
    apply(userId: string, id: string, indexes?: number[]): Promise<{ proposal: Proposal; failed: number[] } | null>;
    dismiss(userId: string, id: string, indexes?: number[]): Promise<Proposal | null>;
  };
  /** Per athlete (DECISIONS #53): `status` says `not_configured` for one without intervals.icu, and syncs then answer 503. */
  intervals: {
    /** Our sync bookkeeping, including a running full import's progress. */
    status(userId: string): Promise<IntegrationStatus>;
    /** When "Sync now" or "Full sync" may run again, or null if it may now (DECISIONS #75). */
    retryAt(status: IntegrationStatus, kind: 'sync' | 'fullSync'): Date | null;
    /** The delta sync ("Sync now"): push, calendar, rides and wellness since the last sync. */
    sync(userId: string): Promise<SyncSummary>;
    /** Start a full import of all history in the background (DECISIONS #49). */
    fullSync(userId: string): Promise<FullSyncProgress>;
  };
  /**
   * Zwift events from our own database (DECISIONS #29). `refresh` re-reads the public feed (at most
   * every 15 min); `extend` starts the one logged-in walk ("Get more events", at most every 6 h).
   */
  events: {
    status(userId: string): Promise<EventsStatus>;
    query(userId: string, query: EventQuery): Promise<EventQueryResult>;
    refresh(): Promise<EventsRefreshResult>;
    extend(userId: string): Promise<EventsExtendResult>;
    searches: {
      list(userId: string): Promise<SavedSearch[]>;
      create(userId: string, input: SavedSearchInput): Promise<SavedSearch>;
      remove(userId: string, id: string): Promise<boolean>;
    };
  };
  /** Foods database, recipes, meals and the log (DECISIONS #33). */
  food: FoodServices;
  /** BMR and body scans (Athlete page). */
  energy: EnergyServices;
  /** Per athlete: `not_configured` without a Zwift login, and zFTP is then entered by hand. */
  zwift: {
    status(userId: string): Promise<ZwiftStatus>;
    /** Pull zFTP, zMAP, weight and FTP from Zwift now; failures come back as `lastError`. */
    sync(userId: string): Promise<ZwiftStatus>;
  };
}

/** A refused request, with the status to answer it with. */
export interface ServiceFailure {
  error: string;
  /** 402: refused by the spend guard (hosted plan limits, DECISIONS #57). */
  status: 400 | 402 | 404 | 409 | 410 | 413 | 502 | 503;
  /** With a 402: where to go about it. */
  action?: TurnStop['action'];
}

const isFailure = (r: object): r is ServiceFailure => 'error' in r && 'status' in r;

/** What a sync did — shown after "Sync now". */
export interface SyncSummary {
  pushed: number;
  imported: number;
  updated: number;
  removed: number;
  /** Rides new or changed since the last sync, and rides deleted in intervals.icu. */
  rides: number;
  ridesRemoved: number;
  /** Rides whose detected intervals were fetched. */
  details: number;
  matched: number;
  missed: number;
  bests: number;
  weightKg?: number | undefined;
}

type Variables = {
  user: Auth['$Infer']['Session']['user'] | null;
  session: Auth['$Infer']['Session']['session'] | null;
};

export interface AppDeps {
  auth: Auth;
  /** What sign-in offers on this server (DECISIONS #61); public at `/api/auth-config`. */
  authConfig: AuthConfig;
  env: Env;
  services: AppServices;
}

const indexesSchema = z.object({ indexes: z.array(z.number().int().min(0)).optional() });
const powerBestsSchema = z.object({ bests: z.array(powerBestSchema).max(60) });

export function createApp(deps: AppDeps) {
  const { auth, authConfig, env, services } = deps;
  const app = new Hono<{ Variables: Variables }>();

  app.use(
    '*',
    cors({
      // Credentials mode requires an explicit origin list — browsers reject a wildcard.
      origin: webOrigins(env),
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['set-auth-token', 'Content-Disposition'],
    }),
  );

  /** One session lookup per request, from a cookie (web) or bearer token (native). */
  app.use('*', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('user', session?.user ?? null);
    c.set('session', session?.session ?? null);
    await next();
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  const api = new Hono<{ Variables: Variables }>()
    .use('*', async (c, next) => {
      if (!c.get('user')) return c.json({ error: 'Unauthorized' }, 401);
      await next();
    })

    .get('/me', async (c) => {
      const user = c.get('user')!;
      const [features, onboarded] = await Promise.all([services.features(user.id), services.onboarding.onboarded(user.id)]);
      return c.json({ id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified, onboarded, features });
    })

    // ── First-run onboarding (DECISIONS #62) ────────────────────────────────
    .get('/onboarding', async (c) => c.json(await services.onboarding.state(c.get('user')!.id)))
    .put('/onboarding/fitness', json(onboardingFitnessSchema), async (c) =>
      c.json(await services.onboarding.saveFitness(c.get('user')!.id, c.req.valid('json'))),
    )
    .put('/onboarding/body', json(onboardingBodySchema), async (c) => c.json(await services.onboarding.saveBody(c.get('user')!.id, c.req.valid('json'))))
    .put('/onboarding/goals', json(onboardingGoalsSchema), async (c) =>
      c.json(await services.onboarding.saveGoals(c.get('user')!.id, c.req.valid('json'))),
    )
    .put('/onboarding/step', json(onboardingStepSchema), async (c) =>
      c.json(await services.onboarding.setStep(c.get('user')!.id, c.req.valid('json').step)),
    )
    .post('/onboarding/finish', async (c) => {
      const r = await services.onboarding.finish(c.get('user')!.id);
      return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
    })

    .get('/dashboard', async (c) => {
      const data = await services.dashboard(c.get('user')!.id);
      return data ? c.json(data) : c.json({ error: 'No profile yet' }, 404);
    })

    .get('/usage', async (c) => c.json(await services.usage(c.get('user')!.id)))

    // ── Profile, PRs, goals, memory ─────────────────────────────────────────
    .get('/profile', async (c) => {
      const data = await services.profile.get(c.get('user')!.id);
      return data ? c.json(data) : c.json({ error: 'No profile yet' }, 404);
    })
    .put('/profile', json(profileSchema), async (c) => {
      await services.profile.save(c.get('user')!.id, c.req.valid('json'));
      return c.json({ ok: true });
    })
    .get('/weight', async (c) => c.json(await services.weight.history(c.get('user')!.id)))
    .put('/power-bests', json(powerBestsSchema), async (c) => {
      await services.profile.savePowerBests(c.get('user')!.id, c.req.valid('json').bests);
      return c.json({ ok: true });
    })
    .post('/goals', json(goalInputSchema), async (c) =>
      c.json(await services.goals.create(c.get('user')!.id, c.req.valid('json')), 201),
    )
    .patch('/goals/:id', json(goalPatchSchema), async (c) => {
      const goal = await services.goals.update(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      return goal ? c.json(goal) : c.json({ error: 'Not found' }, 404);
    })
    .delete('/goals/:id', async (c) =>
      (await services.goals.remove(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404),
    )
    .post('/memories', json(memoryInputSchema), async (c) => {
      const m = await services.memories.create(c.get('user')!.id, c.req.valid('json'));
      return 'error' in m ? c.json({ error: m.error }, 400) : c.json(m, 201);
    })
    .patch('/memories/:id', json(memoryPatchSchema), async (c) => {
      const result = await services.memories.update(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      if (!result) return c.json({ error: 'Not found' }, 404);
      return 'error' in result ? c.json({ error: result.error }, 400) : c.json(result.memory);
    })
    .delete('/memories/:id', async (c) => {
      const m = await services.memories.remove(c.get('user')!.id, c.req.param('id'));
      return m ? c.json(m) : c.json({ error: 'Not found' }, 404);
    })
    .post('/memories/:id/restore', async (c) => {
      const m = await services.memories.restore(c.get('user')!.id, c.req.param('id'));
      return m ? c.json(m) : c.json({ error: 'Not found' }, 404);
    })
    .post('/memories/:id/review', async (c) => {
      const m = await services.memories.review(c.get('user')!.id, c.req.param('id'));
      return m ? c.json(m) : c.json({ error: 'Not found' }, 404);
    })
    .post('/memories/:id/revert', json(memoryRevertSchema), async (c) => {
      const m = await services.memories.revert(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      return m ? c.json(m) : c.json({ error: 'That note has changed since, so it was left as it is.' }, 409);
    })

    // ── Workouts ────────────────────────────────────────────────────────────
    .get('/workouts', async (c) => c.json(await services.workouts.list(c.get('user')!.id)))
    .get('/workouts/:id', async (c) => {
      const w = await services.workouts.get(c.get('user')!.id, c.req.param('id'));
      return w ? c.json(w) : c.json({ error: 'Not found' }, 404);
    })
    .get('/workouts/:id/zwo', async (c) => {
      const w = await services.workouts.get(c.get('user')!.id, c.req.param('id'));
      if (!w) return c.json({ error: 'Not found' }, 404);
      return c.body(buildZwo(w, { author: c.get('user')!.name || 'Cycling Coach' }), 200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${zwoFileName(w.name)}"`,
      });
    })
    .delete('/workouts/:id', async (c) =>
      (await services.workouts.archive(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404),
    )

    // ── Calendar ────────────────────────────────────────────────────────────
    .get('/calendar', query(calendarRangeQuerySchema), async (c) => {
      const { from, to } = c.req.valid('query');
      return c.json(await services.calendar.list(c.get('user')!.id, from, to));
    })
    .post('/calendar', json(calendarEventInputSchema), async (c) =>
      c.json(await services.calendar.create(c.get('user')!.id, c.req.valid('json')), 201),
    )
    .patch('/calendar/:id', json(calendarEventPatchSchema), async (c) => {
      const result = await services.calendar.patch(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      return result ? c.json(result) : c.json({ error: 'Not found' }, 404);
    })
    .delete('/calendar/:id', async (c) => {
      const result = await services.calendar.remove(c.get('user')!.id, c.req.param('id'));
      if (!result) return c.json({ error: 'Not found' }, 404);
      return 'error' in result ? c.json({ error: result.error }, 409) : c.json({ ok: true });
    })
    .post('/calendar/:id/sync', async (c) => {
      const e = await services.calendar.resync(c.get('user')!.id, c.req.param('id'));
      return e ? c.json(e) : c.json({ error: 'Not found' }, 404);
    })
    .post('/calendar/:id/unlink', async (c) => {
      const e = await services.calendar.unlinkRide(c.get('user')!.id, c.req.param('id'));
      if (!e) return c.json({ error: 'Not found' }, 404);
      return 'error' in e ? c.json({ error: e.error }, 409) : c.json(e);
    })
    .post('/calendar/:id/rides', json(sessionRideInputSchema), async (c) => {
      const e = await services.calendar.addRide(c.get('user')!.id, c.req.param('id'), c.req.valid('json').activityId);
      if (!e) return c.json({ error: 'Not found' }, 404);
      return isFailure(e) ? c.json({ error: e.error }, e.status) : c.json(e);
    })
    .delete('/calendar/:id/rides/:activityId', async (c) => {
      const e = await services.calendar.removeRide(c.get('user')!.id, c.req.param('id'), c.req.param('activityId'));
      if (!e) return c.json({ error: 'Not found' }, 404);
      return isFailure(e) ? c.json({ error: e.error }, e.status) : c.json(e);
    })
    .get('/calendar/:id/result', async (c) => {
      const r = await services.calendar.result(c.get('user')!.id, c.req.param('id'));
      return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
    })

    // ── Time off ────────────────────────────────────────────────────────────
    .get('/time-off', query(calendarRangeQuerySchema), async (c) => {
      const { from, to } = c.req.valid('query');
      return c.json(await services.timeOff.list(c.get('user')!.id, from, to));
    })
    .post('/time-off', json(timeOffInputSchema), async (c) => c.json(await services.timeOff.create(c.get('user')!.id, c.req.valid('json')), 201))
    .patch('/time-off/:id', json(timeOffPatchSchema), async (c) => {
      const entry = await services.timeOff.patch(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      if (!entry) return c.json({ error: 'Not found' }, 404);
      return isFailure(entry) ? c.json({ error: entry.error }, entry.status) : c.json(entry);
    })
    .delete('/time-off/:id', async (c) =>
      (await services.timeOff.remove(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404),
    )

    // ── Ride feedback ───────────────────────────────────────────────────────
    .put('/feedback', json(sessionFeedbackInputSchema), async (c) => {
      const r = await services.feedback.save(c.get('user')!.id, c.req.valid('json'));
      return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
    })

    // ── Food & energy (sub-routers keep this chain's type manageable) ──────
    .route('/food', foodRoutes(services.food))
    .route('/energy', energyRoutes(services.energy))

    // ── Coach threads ───────────────────────────────────────────────────────
    .get('/threads', query(threadListQuerySchema), async (c) => {
      const { limit } = c.req.valid('query');
      return c.json(await services.threads.list(c.get('user')!.id, limit ? Math.min(Number(limit), THREAD_LIST_MAX) : undefined));
    })
    .get('/coach/check', async (c) => c.json({ refused: await services.threads.check(c.get('user')!.id) }))
    .post('/threads', async (c) => {
      const t = await services.threads.create(c.get('user')!.id);
      return t ? c.json(t, 201) : c.json({ error: 'Create your profile first' }, 409);
    })
    .get('/threads/:id', async (c) => {
      const view = await services.threads.view(c.get('user')!.id, c.req.param('id'));
      return view ? c.json(view) : c.json({ error: 'Not found' }, 404);
    })
    /** One coach turn, streamed as SSE (`data:` lines carrying `CoachEvent` JSON). */
    .post('/threads/:id/messages', json(sendMessageSchema), async (c) => {
      const input = c.req.valid('json');
      const userId = c.get('user')!.id;
      const threadId = c.req.param('id');
      return streamSSE(c, async (stream) => {
        const abort = new AbortController();
        stream.onAbort(() => abort.abort());
        // A plan's input can take minutes with nothing to send, and a proxy that drops a quiet
        // connection would abort the turn. Comment frames carry no event.
        const keepAlive = setInterval(() => void stream.write(': ping\n\n'), 15_000);
        try {
          for await (const event of services.threads.send(userId, threadId, input, abort.signal)) {
            await stream.writeSSE({ data: JSON.stringify(event) });
          }
        } catch (err) {
          console.error('coach turn failed', err);
          await stream.writeSSE({
            data: JSON.stringify({ type: 'error', message: 'Something went wrong on the server.', retryable: true } satisfies CoachEvent),
          });
        } finally {
          clearInterval(keepAlive);
        }
      });
    })
    .get('/coach-food/ideas/:id', async (c) => {
      const r = await services.coachFood.ideas(c.get('user')!.id, c.req.param('id'));
      return r ? c.json(r) : c.json({ error: 'Not found' }, 404);
    })
    .patch('/coach-food/ideas/:id', json(mealIdeaFixSchema), async (c) => {
      const r = await services.coachFood.fixIdeaIngredient(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
    })
    .get('/coach-food/recipes/:id', async (c) => {
      const r = await services.coachFood.get(c.get('user')!.id, c.req.param('id'));
      return r ? c.json(r) : c.json({ error: 'Not found' }, 404);
    })
    .patch('/coach-food/recipes/:id', json(recipeDraftPatchSchema), async (c) => {
      const r = await services.coachFood.patch(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
    })
    .post('/coach-food/recipes/:id/save', async (c) => {
      const r = await services.coachFood.save(c.get('user')!.id, c.req.param('id'));
      return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
    })
    .post('/coach-food/recipes/:id/log', json(recipeDraftLogSchema), async (c) => {
      const r = await services.coachFood.log(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
    })
    .get('/proposals/:id', async (c) => {
      const p = await services.proposals.get(c.get('user')!.id, c.req.param('id'));
      return p ? c.json(p) : c.json({ error: 'Not found' }, 404);
    })
    .post('/proposals/:id/apply', json(indexesSchema), async (c) => {
      const result = await services.proposals.apply(c.get('user')!.id, c.req.param('id'), c.req.valid('json').indexes);
      return result ? c.json(result) : c.json({ error: 'Not found' }, 404);
    })
    .post('/proposals/:id/dismiss', json(indexesSchema), async (c) => {
      const p = await services.proposals.dismiss(c.get('user')!.id, c.req.param('id'), c.req.valid('json').indexes);
      return p ? c.json(p) : c.json({ error: 'Not found' }, 404);
    })

    // ── intervals.icu ───────────────────────────────────────────────────────
    .get('/integrations/intervals', async (c) => c.json<IntegrationStatus>(await services.intervals.status(c.get('user')!.id)))
    .post('/integrations/intervals/sync', async (c) => {
      const userId = c.get('user')!.id;
      const status = await services.intervals.status(userId);
      if (status.status === 'not_configured') return c.json({ error: 'intervals.icu is not connected' }, 503);
      const retryAt = services.intervals.retryAt(status, 'sync');
      if (retryAt) return c.json({ error: 'Synced a few minutes ago. Try again shortly.', retryAt: retryAt.toISOString() }, 409);
      return c.json(await services.intervals.sync(userId));
    })
    .post('/integrations/intervals/full-sync', async (c) => {
      const userId = c.get('user')!.id;
      const status = await services.intervals.status(userId);
      if (status.status === 'not_configured') return c.json({ error: 'intervals.icu is not connected' }, 503);
      const retryAt = services.intervals.retryAt(status, 'fullSync');
      if (retryAt) return c.json({ error: 'A full sync ran in the last day. Try again tomorrow.', retryAt: retryAt.toISOString() }, 409);
      return c.json(await services.intervals.fullSync(userId), 202);
    })

    // ── Zwift events (read from our database; DECISIONS #29) ───────────────
    .get('/events/status', async (c) => c.json(await services.events.status(c.get('user')!.id)))
    .post('/events/query', json(eventQuerySchema), async (c) => c.json(await services.events.query(c.get('user')!.id, c.req.valid('json'))))
    .post('/events/refresh', async (c) => {
      const result = await services.events.refresh();
      if (result.kind === 'too_soon') return c.json({ error: 'Synced a few minutes ago', retryAt: result.retryAt }, 409);
      return c.json(await services.events.status(c.get('user')!.id));
    })
    .post('/events/extend', async (c) => {
      const userId = c.get('user')!.id;
      const result = await services.events.extend(userId);
      if (result.kind === 'not_configured') return c.json({ error: 'No Zwift login for this account' }, 503);
      if (result.kind === 'cooldown') return c.json({ error: 'Already fetched recently', nextAllowedAt: result.nextAllowedAt }, 409);
      return c.json(await services.events.status(userId));
    })
    .get('/events/searches', async (c) => c.json(await services.events.searches.list(c.get('user')!.id)))
    .post('/events/searches', json(savedSearchInputSchema), async (c) =>
      c.json(await services.events.searches.create(c.get('user')!.id, c.req.valid('json')), 201),
    )
    .delete('/events/searches/:id', async (c) =>
      (await services.events.searches.remove(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404),
    )

    // ── Zwift ───────────────────────────────────────────────────────────────
    .get('/integrations/zwift', async (c) => c.json<ZwiftStatus>(await services.zwift.status(c.get('user')!.id)))
    .post('/integrations/zwift/sync', async (c) => c.json<ZwiftStatus>(await services.zwift.sync(c.get('user')!.id)));

  /**
   * Routes must be CHAINED to appear in `AppType`; a bare `app.get(...)` statement works at
   * runtime but is invisible to the RPC client.
   */
  // `/api/public` is registered before `/api`, so it answers before the auth guard runs.
  return app
    .get('/health', (c) => c.json({ ok: true, service: 'cycling-coach-api' }))
    // Public: the sign-in and register pages ask before anyone is signed in. Not under
    // `/api/auth/*`, which belongs to Better Auth.
    .get('/api/auth-config', (c) => c.json<AuthConfig>(authConfig))
    .route('/api/public', publicRoutes(services.public))
    .route('/api', api);
}

/** The SPA's typed RPC client is built from this. No codegen step. */
export type AppType = ReturnType<typeof createApp>;
