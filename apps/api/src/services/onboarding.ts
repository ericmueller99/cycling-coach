import { addDays, inferSessionType, RAMP_TEST, STARTER_WORKOUTS, todayIn, workoutMetrics } from '@cycling-coach/core';
import {
  createGoal,
  createWorkout,
  deleteGoal,
  getOnboarding,
  getProfile,
  isOnboarded,
  listGoals,
  listMemories,
  listWorkouts,
  saveOnboarding,
  saveProfile,
  type Collections,
  type OnboardingDoc,
} from '@cycling-coach/db';
import {
  ONBOARDING_DONE_STEP,
  ONBOARDING_GOAL_LABEL,
  type GoalInput,
  type OnboardingBody,
  type OnboardingFitness,
  type OnboardingGoals,
  type OnboardingState,
  type Profile,
} from '@cycling-coach/shared';
import type { ServiceFailure } from '../app';
import type { CalendarService } from './calendar';

const KG_PER_LB = 0.45359237;

/** An IANA zone this server can use, else UTC. */
export function usableTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * The wizard's goals as long-term goals (DECISIONS #62). One main goal: the athlete's own words,
 * else the event, else the first chip. The other chips become its "Focus" line, not goals of their
 * own, so the Athlete page isn't filled with near-duplicates. No measures: the coach proposes those.
 */
export function onboardingGoalInputs(g: OnboardingGoals): GoalInput[] {
  const focus = g.chips.filter((c) => c !== 'event').map((c) => ONBOARDING_GOAL_LABEL[c]);
  const event = g.chips.includes('event') ? g.event : undefined;
  const goals: GoalInput[] = [];
  if (g.main) goals.push({ horizon: 'long', title: g.main.title, ...(g.main.date ? { targetDate: g.main.date } : {}), done: false, primary: true });
  if (event) goals.push({ horizon: 'long', title: `Get ready for ${event.name}`.slice(0, 120), targetDate: event.date, done: false, primary: !g.main });
  const rest = g.main || event ? focus : focus.slice(1);
  if (!g.main && !event && focus[0]) goals.push({ horizon: 'long', title: focus[0], done: false, primary: true });
  const main = goals.find((x) => x.primary);
  if (main && rest.length) main.detail = `${g.main || event ? 'Focus' : 'Also'}: ${rest.join(' · ')}`;
  return goals;
}

/** The athlete's starting library, once: the seed script and onboarding both use it. */
export async function seedStarterLibrary(c: Collections, userId: string, now: Date): Promise<number> {
  if ((await c.workouts.countDocuments({ userId }, { limit: 1 })) > 0) return 0;
  for (const w of STARTER_WORKOUTS) await createWorkout(c, userId, w, 'seed', now);
  return STARTER_WORKOUTS.length;
}

/**
 * First-run onboarding (DECISIONS #62). Fitness and Body make the profile; Goals makes goals; the
 * Memory step uses the ordinary memory routes; `finish` books the ramp test when FTP is unknown.
 */
export class OnboardingService {
  constructor(
    private readonly c: Collections,
    private readonly calendar: Pick<CalendarService, 'create'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  onboarded(userId: string): Promise<boolean> {
    return isOnboarded(this.c, userId);
  }

  async state(userId: string): Promise<OnboardingState> {
    const [doc, profile, goals, memories] = await Promise.all([
      getOnboarding(this.c, userId),
      getProfile(this.c, userId),
      listGoals(this.c, userId),
      listMemories(this.c, userId),
    ]);
    const mine = new Set(doc?.goalIds ?? []);
    return {
      step: doc?.step ?? 0,
      fitness: doc?.fitness ?? null,
      body: profile ? { weightKg: profile.weightKg, unit: doc?.unit ?? 'kg' } : null,
      goals: doc?.goals ?? null,
      createdGoals: goals.filter((g) => mine.has(g.id)),
      memories,
      rampTest: doc?.rampTest ?? null,
      completedAt: doc?.completedAt?.toISOString() ?? null,
    };
  }

  async saveFitness(userId: string, fitness: OnboardingFitness): Promise<OnboardingState> {
    await saveOnboarding(this.c, userId, { fitness, step: 1 }, this.now());
    // Back from the summary: the profile already exists, so it follows the new answer.
    const profile = await getProfile(this.c, userId);
    if (profile) await saveProfile(this.c, userId, withFitness(profile, fitness), this.now());
    return this.state(userId);
  }

  async saveBody(userId: string, body: OnboardingBody): Promise<OnboardingState> {
    const doc = await getOnboarding(this.c, userId);
    const current = await getProfile(this.c, userId);
    // Two decimals, so a weight typed in lb reads back as typed.
    const kg = Math.round((body.unit === 'lb' ? body.weightKg * KG_PER_LB : body.weightKg) * 100) / 100;
    // A weight synced from intervals.icu wins over what's typed here, as on the Athlete page.
    const synced = current?.weightSource === 'intervals.icu';
    const base: Profile = current ?? { weightKg: kg, weightSource: 'manual', timezone: 'UTC' };
    const profile: Profile = {
      ...base,
      ...(synced ? {} : { weightKg: kg, weightSource: 'manual' as const }),
      timezone: usableTimezone(body.timezone),
    };
    await saveProfile(this.c, userId, doc?.fitness ? withFitness(profile, doc.fitness) : profile, this.now());
    await seedStarterLibrary(this.c, userId, this.now());
    await saveOnboarding(this.c, userId, { unit: body.unit, step: 2 }, this.now());
    return this.state(userId);
  }

  /** Replaces the goals this wizard made before, so going back and changing them never duplicates. */
  async saveGoals(userId: string, goals: OnboardingGoals): Promise<OnboardingState> {
    const doc = await getOnboarding(this.c, userId);
    for (const id of doc?.goalIds ?? []) await deleteGoal(this.c, userId, id);
    const goalIds: string[] = [];
    for (const g of onboardingGoalInputs(goals)) goalIds.push((await createGoal(this.c, userId, g, this.now())).id);
    await saveOnboarding(this.c, userId, { goals, goalIds, step: 3 }, this.now());
    return this.state(userId);
  }

  async setStep(userId: string, step: number): Promise<OnboardingState> {
    await saveOnboarding(this.c, userId, { step }, this.now());
    return this.state(userId);
  }

  async finish(userId: string): Promise<OnboardingState | ServiceFailure> {
    const [doc, profile] = await Promise.all([getOnboarding(this.c, userId), getProfile(this.c, userId)]);
    if (!profile) return { error: 'Add your weight first', status: 409 };
    if (doc?.fitness?.known === false && !doc.rampTest && !profile.ftpZwift) {
      const rampTest = await this.bookRampTest(userId, profile.timezone);
      await saveOnboarding(this.c, userId, { rampTest }, this.now());
    }
    await saveOnboarding(this.c, userId, { completedAt: this.now(), step: ONBOARDING_DONE_STEP }, this.now());
    return this.state(userId);
  }

  /** Tomorrow, in the athlete's own day. Through the calendar service, so it reaches intervals.icu (rule 1). */
  private async bookRampTest(userId: string, timezone: string): Promise<NonNullable<OnboardingDoc['rampTest']>> {
    const library = await listWorkouts(this.c, userId);
    const workout = library.find((w) => w.name === RAMP_TEST.name) ?? (await createWorkout(this.c, userId, RAMP_TEST, 'seed', this.now()));
    const date = addDays(todayIn(timezone, this.now()), 1);
    const event = await this.calendar.create(
      userId,
      {
        date,
        kind: 'workout',
        type: inferSessionType(workout.segments),
        title: workout.name,
        workoutId: workout.id,
        durationMin: Math.round(workoutMetrics(workout.segments).totalSec / 60),
        tentative: false,
        coachNote: 'Your first workout sets your FTP. Ride until you can no longer hold the target. Move it to any day that suits you.',
      },
      { source: 'manual' },
    );
    return { date, eventId: event.id };
  }
}

function withFitness(profile: Profile, fitness: OnboardingFitness): Profile {
  const { ftpZwift: _f, ftpSource: _s, ...rest } = profile;
  return fitness.known ? { ...rest, ftpZwift: fitness.ftp, ftpSource: fitness.source } : rest;
}
