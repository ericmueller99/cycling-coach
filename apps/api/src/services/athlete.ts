import type { AthleteContext } from '@cycling-coach/coach';
import { addDays, coachEvents, eventGoalWeight, goalForEvent, goalProgress, isEventSession, isShortTerm, todayIn, wattsPerKg, weekDates } from '@cycling-coach/core';
import {
  getProfile,
  getUserName,
  listEvents,
  listGoals,
  listMemories,
  listPowerBests,
  listWorkouts,
  type Collections,
} from '@cycling-coach/db';
import type { DashboardPayload, FitnessDay, Goal, IntegrationStatus, IsoDate, PowerBest, Profile } from '@cycling-coach/shared';

/** Goals with their live progress — goals store a measure and target, never a current value. */
export function withProgress(goals: Goal[], profile: Profile, powerBests: PowerBest[], ctl?: number): Goal[] {
  const snapshot = {
    ftp: profile.ftpZwift,
    weightKg: profile.weightKg,
    zwiftWeightKg: profile.zwiftWeightKg,
    zftp: profile.zwift?.zftp,
    zmap: profile.zwift?.zmap,
    powerBests,
    ctl,
  };
  return goals.map((g) => {
    const progress = goalProgress(g, snapshot);
    return progress ? { ...g, progress } : g;
  });
}

/** @param ctl today's fitness, when known, for fitness goals */
export async function loadAthleteContext(c: Collections, userId: string, ctl?: number): Promise<AthleteContext | null> {
  const [profile, name, powerBests, goals, notes, workouts] = await Promise.all([
    getProfile(c, userId),
    getUserName(c, userId),
    listPowerBests(c, userId),
    listGoals(c, userId),
    listMemories(c, userId),
    listWorkouts(c, userId),
  ]);
  if (!profile) return null;
  return {
    ...(name ? { name } : {}),
    profile,
    powerBests,
    goals: withProgress(goals, profile, powerBests, ctl),
    // Split here so a short-term note can never reach the block a new thread freezes.
    memories: notes.filter((m) => !isShortTerm(m)),
    shortTerm: notes.filter(isShortTerm),
    workouts,
  };
}

/** The athlete's local date and wall-clock time at `now`. */
export function localNow(timezone: string, now: Date): { today: IsoDate; localTime: string } {
  return {
    today: todayIn(timezone, now),
    localTime: new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(now),
  };
}

export async function buildDashboard(
  c: Collections,
  userId: string,
  intervals: IntegrationStatus,
  /** Fitness for a date; failures should resolve to undefined, not throw. */
  fitnessFor: (date: IsoDate) => Promise<FitnessDay | undefined>,
  now: Date,
): Promise<DashboardPayload | null> {
  const profileOnly = await getProfile(c, userId);
  if (!profileOnly) return null;
  const { today } = localNow(profileOnly.timezone, now);
  const fitness = await fitnessFor(today);
  const ctx = await loadAthleteContext(c, userId, fitness?.ctl);
  if (!ctx) return null;
  const { profile } = ctx;
  const days = weekDates(today);
  const events = await listEvents(c, userId, days[0]!, days[6]!);
  const nextRace = (await listEvents(c, userId, addDays(today, 1), addDays(today, 28)))
    .filter((e) => e.type === 'race' && e.status === 'planned')
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  // "Best 5 min" on the rail is the 90-day number — current form, not a lifetime record.
  const best5 =
    ctx.powerBests.find((b) => b.durationSec === 300 && b.period === '90d' && b.watts) ??
    ctx.powerBests.filter((b) => b.durationSec === 300 && b.watts).sort((a, b) => (b.watts ?? 0) - (a.watts ?? 0))[0];
  const mainGoal = ctx.goals.find((g) => g.primary) ?? ctx.goals.find((g) => g.horizon === 'long');
  // The rail's Coming up: the next few real-world events and how the coach treats each (DECISIONS #101).
  const ahead = coachEvents(await listEvents(c, userId, today, addDays(today, 730)), ctx.goals).filter(isEventSession).slice(0, 3);
  const upcomingEvents = ahead.map((e) => {
    const goal = goalForEvent(ctx.goals, e.id);
    return { id: e.id, title: e.title, date: e.date, weight: goal ? eventGoalWeight(goal) : null };
  });
  return {
    today,
    timezone: profile.timezone,
    todayEvents: events.filter((e) => e.date === today),
    week: days.map((date) => ({ date, events: events.filter((e) => e.date === date) })),
    ...(nextRace ? { nextRace: { date: nextRace.date, title: nextRace.title } } : {}),
    snapshot: {
      ...(profile.ftpZwift ? { ftpZwift: profile.ftpZwift } : {}),
      weightKg: profile.weightKg,
      ...(profile.weightLatest ? { weightLatest: profile.weightLatest } : {}),
      ...(profile.zwiftWeightKg ? { zwiftWeightKg: profile.zwiftWeightKg } : {}),
      ...(profile.zwift?.source === 'zwift' ? { zwiftWeightSynced: true } : {}),
      ...(profile.ftpZwift ? { wattsPerKg: wattsPerKg(profile.ftpZwift, profile.weightKg) } : {}),
      ...(best5?.watts ? { best5minW: best5.watts } : {}),
      ...(fitness ? { fitness } : {}),
    },
    ...(mainGoal ? { mainGoal } : {}),
    ...(upcomingEvents.length ? { upcomingEvents } : {}),
    intervals,
  };
}

/** The window of calendar the coach sees each turn: last week (what happened) + next two. */
export function coachCalendarWindow(today: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: addDays(today, -7), to: addDays(today, 14) };
}

/** Events reach furthest: a fondo next September shapes training now (DECISIONS #101). */
export function coachEventsWindow(today: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: today, to: addDays(today, 730) };
}

/** Time off reaches much further ahead than sessions: a plan weeks out has to know about a vacation. */
export function coachTimeOffWindow(today: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: addDays(today, -14), to: addDays(today, 180) };
}
