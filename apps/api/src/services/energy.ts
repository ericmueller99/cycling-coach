import { addDays, dailyBudget, dayTotals, todayIn, trendSeries, TREND_DAYS, weekStart, weekTrends, type PlannedSession, type WeightGoalInput } from '@cycling-coach/core';
import {
  createBodyScan,
  getProfile,
  getWorkout,
  listEvents,
  listGoals,
  deleteBodyScan,
  getEnergySettings,
  getFoodSettings,
  listBodyScans,
  listLog,
  patchEnergySettings,
  updateBodyScan,
  type Collections,
} from '@cycling-coach/db';
import type { Activity, BodyScanInput, BodyScanPatch, CalendarEvent, DaysPayload, EnergyBudget, EnergyPatch, EnergyPayload, EnergySettings, Goal, IsoDate, Profile, StepDay, Workout } from '@cycling-coach/shared';
import type { TrainingData } from './training-data';

/** The open weight goal that drives the budget: the primary one, else the soonest dated, else the first. */
export function weightGoal(goals: readonly Goal[]): WeightGoalInput | undefined {
  const open = goals.filter((g) => !g.done && g.measure?.kind === 'weight' && g.target != null);
  const pick = open.find((g) => g.primary) ?? [...open].sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))[0];
  return pick ? { id: pick.id, title: pick.title, target: pick.target!, ...(pick.targetDate ? { targetDate: pick.targetDate } : {}) } : undefined;
}

interface BudgetContext {
  settings: EnergySettings;
  profile: Profile | null;
  goals: Goal[];
  events: CalendarEvent[];
  workouts: Map<string, Workout>;
  today: IsoDate;
  activities: Activity[];
  steps: StepDay[];
  dataWarning: string | undefined;
}

/**
 * BMR, body scans and the daily calorie budget (Athlete page; DECISIONS #35–36). Kept out of the
 * profile document so a BMR edit never re-renders the coach's athlete block.
 */
export class EnergyService {
  constructor(
    private readonly c: Collections,
    /** Synced rides, steps and weigh-ins; null when intervals.icu isn't configured. */
    private readonly training: TrainingData | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Everything a budget needs for a range of days, read once: settings, profile, goals, sessions,
   * their workouts, and the synced rides and steps (DECISIONS #49). Without intervals.icu the
   * budget has no exercise or steps, and says so.
   */
  private async context(userId: string, from: IsoDate, to: IsoDate, hidden: readonly string[] = []): Promise<BudgetContext> {
    const [settings, profile, goals, events] = await Promise.all([
      getEnergySettings(this.c, userId),
      getProfile(this.c, userId),
      listGoals(this.c, userId),
      listEvents(this.c, userId, from, to),
    ]);
    const today = todayIn(profile?.timezone ?? 'UTC', this.now());
    let activities: Activity[] = [];
    let steps: StepDay[] = [];
    let dataWarning: string | undefined;
    if (this.training) {
      [activities, steps] = await Promise.all([this.training.activities(userId, from, to), this.training.steps(userId, addDays(from, -15), to)]);
      activities = activities.filter((a) => !a.provider || !hidden.includes(a.provider));
    } else dataWarning = 'intervals.icu is not connected — exercise and steps are missing.';
    const workoutIds = [...new Set(events.filter((e) => e.status === 'planned' && e.workoutId).map((e) => e.workoutId!))];
    const workouts = new Map<string, Workout>();
    for (const w of await Promise.all(workoutIds.map((id) => getWorkout(this.c, userId, id)))) if (w) workouts.set(w.id, w);
    return { settings, profile, goals, events, workouts, today, activities, steps, dataWarning };
  }

  /** One day's budget from a loaded context — the same maths for one day or a range. */
  private dayBudget(x: BudgetContext, date: IsoDate): EnergyBudget {
    const planned: PlannedSession[] = x.events
      .filter((e) => e.status === 'planned' && e.date === date)
      .map((e) => {
        const workout = e.workoutId ? x.workouts.get(e.workoutId) : undefined;
        return { id: e.id, title: e.title, type: e.type, durationMin: e.durationMin, ...(workout ? { segments: workout.segments } : {}) };
      });
    const weightKg = x.profile?.weightKg ?? 75;
    const ftp = x.profile?.ftpZwift ?? 250;
    const budget = dailyBudget({
      date,
      today: x.today,
      settings: x.settings,
      weightKg,
      trendKg: x.profile?.weightKg,
      ftp,
      steps: x.steps,
      activities: x.activities.filter((a) => a.startLocal.slice(0, 10) === date),
      planned,
      goal: weightGoal(x.goals),
      ...(x.dataWarning ? { dataWarning: x.dataWarning } : {}),
    });
    return { ...budget, weightKg, ftp };
  }

  /**
   * One day's budget: RMR + everyday living + steps + exercise (rides' kJ, planned sessions
   * projected until ridden) + the weight goal's adjustment.
   */
  async budget(userId: string, date: IsoDate, hidden: readonly string[] = []): Promise<EnergyBudget> {
    return this.dayBudget(await this.context(userId, date, date, hidden), date);
  }

  /** Every day's budget in a range, from one read of each source (the calendar grid). */
  async budgets(userId: string, from: IsoDate, to: IsoDate): Promise<EnergyBudget[]> {
    const x = await this.context(userId, from, to);
    const out: EnergyBudget[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(this.dayBudget(x, d));
    return out;
  }

  /**
   * The calendar's food layer: eaten vs budget per day and the trend weight per
   * week. One request per page of weeks; the training layer stays on `/api/calendar`.
   */
  async days(userId: string, from: IsoDate, to: IsoDate): Promise<DaysPayload> {
    const [x, entries, food] = await Promise.all([this.context(userId, from, to), listLog(this.c, userId, from, to), getFoodSettings(this.c, userId)]);
    const totals = dayTotals(
      entries,
      food.slots.map((s) => s.name),
    );
    const days: DaysPayload['days'] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const b = this.dayBudget(x, d);
      const t = totals.get(d);
      days.push({ date: d, eaten: t?.eaten ?? null, slots: t?.slots ?? [], budget: b.ready ? b.total : null, estimates: t?.estimates ?? 0 });
    }
    const starts: IsoDate[] = [];
    for (let w = weekStart(from); w <= to; w = addDays(w, 7)) starts.push(w);
    let weeks: DaysPayload['weeks'] = starts.map((start) => ({ start, trendKg: null }));
    if (this.training && starts.length && starts[0]! <= x.today) {
      const weighIns = await this.training.weighIns(userId, addDays(starts[0]!, -(TREND_DAYS - 1)), to < x.today ? to : x.today);
      weeks = weekTrends(trendSeries(weighIns), starts, x.today);
    }
    return { days, weeks, ...(x.dataWarning ? { warning: x.dataWarning } : {}) };
  }

  async get(userId: string): Promise<EnergyPayload> {
    const [settings, scans] = await Promise.all([getEnergySettings(this.c, userId), listBodyScans(this.c, userId)]);
    return { settings, scans };
  }

  async patch(userId: string, patch: EnergyPatch): Promise<EnergyPayload> {
    await patchEnergySettings(this.c, userId, patch, this.now());
    return this.get(userId);
  }

  addScan(userId: string, input: BodyScanInput) {
    return createBodyScan(this.c, userId, input, this.now());
  }

  updateScan(userId: string, id: string, patch: BodyScanPatch) {
    return updateBodyScan(this.c, userId, id, patch);
  }

  deleteScan(userId: string, id: string) {
    return deleteBodyScan(this.c, userId, id);
  }
}
