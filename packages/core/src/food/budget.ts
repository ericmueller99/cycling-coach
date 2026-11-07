import type {
  Activity,
  BudgetExercise,
  BudgetLine,
  EnergyBudget,
  EnergySettings,
  GoalPace,
  IsoDate,
  MacroTargets,
  SessionType,
  StepDay,
  WeightPace,
  WorkoutSegment,
} from '@cycling-coach/shared';
import { addDays } from '../dates';
import { paceKgPerWeek, paceLabel, weightEta } from '../goals';
import { flatten } from '../workout';

/**
 * The daily calorie budget (DECISIONS #36). Activity isn't asked for — it comes
 * from data already synced:
 *
 *   budget = RMR + everyday living (RMR × 0.10) + steps + exercise + goal adjustment
 *
 * Steps come from the watch or phone, via intervals.icu wellness. Rides count their kJ of work (≈ kcal for
 * cycling at ~24% gross efficiency), other activities the device's estimate. The goal adjustment
 * comes from the open weight goal on the Athlete page; none means maintain.
 */

export type ResolvedEnergySettings = Pick<EnergySettings, 'bmrKcal' | 'bmrSource' | 'bmrDate' | 'bmrNote'> & {
  [K in 'activityMode' | 'activityFactor' | 'exerciseSource' | 'protectHardDays' | 'defaultKgPerWeek' | 'proteinGPerKg' | 'fatGPerKg']-?: NonNullable<EnergySettings[K]>;
};

export const ENERGY_DEFAULTS = {
  activityMode: 'steps',
  activityFactor: 1.3,
  exerciseSource: 'power',
  protectHardDays: false,
  defaultKgPerWeek: 0.5,
  proteinGPerKg: 1.8,
  fatGPerKg: 0.85,
} as const;

export function energyDefaults(s: EnergySettings): ResolvedEnergySettings {
  return {
    ...s,
    activityMode: s.activityMode ?? ENERGY_DEFAULTS.activityMode,
    activityFactor: s.activityFactor ?? ENERGY_DEFAULTS.activityFactor,
    exerciseSource: s.exerciseSource ?? ENERGY_DEFAULTS.exerciseSource,
    protectHardDays: s.protectHardDays ?? ENERGY_DEFAULTS.protectHardDays,
    defaultKgPerWeek: s.defaultKgPerWeek ?? ENERGY_DEFAULTS.defaultKgPerWeek,
    proteinGPerKg: s.proteinGPerKg ?? ENERGY_DEFAULTS.proteinGPerKg,
    fatGPerKg: s.fatGPerKg ?? ENERGY_DEFAULTS.fatGPerKg,
  };
}

/** Everyday living on top of BMR (digestion, sitting, standing) — before any steps. */
export const LIVING_FACTOR = 0.1;
/** Net walking cost ≈ 0.5 kcal per kg per km at ~1,333 steps/km. */
export const KCAL_PER_STEP_PER_KG = 0.0004;
/** kcal per kg of body weight change. */
export const KCAL_PER_KG = 7700;
/** At or above this much exercise a day counts as hard. */
export const HARD_DAY_KCAL = 900;
/** Inside this of the target the goal counts as reached. */
const REACHED_KG = 0.3;
const MAX_LOSS_PER_WEEK = 1.0;
const MAX_GAIN_PER_WEEK = 0.5;
/** Steps used for today: the larger of this many days' average and the count so far. */
export const STEPS_AVERAGE_DAYS = 14;

const round5 = (n: number) => Math.round(n / 5) * 5;

export const stepsKcal = (steps: number, weightKg: number) => Math.round(steps * weightKg * KCAL_PER_STEP_PER_KG);

/** One activity's calories: kJ of work for power activities (unless set to device), else the device's estimate. */
export function exerciseKcal(a: Pick<Activity, 'kilojoules' | 'calories'>, source: 'power' | 'device'): { kcal: number; basis: 'kJ' | 'device' } | null {
  if (source === 'power' && a.kilojoules) return { kcal: a.kilojoules, basis: 'kJ' };
  if (a.calories) return { kcal: a.calories, basis: 'device' };
  if (a.kilojoules) return { kcal: a.kilojoules, basis: 'kJ' };
  return null;
}

/** Typical intensity (fraction of FTP) of a session type with no workout file. */
const TYPE_INTENSITY: Record<SessionType, number> = { race: 0.85, intervals: 0.75, openers: 0.65, endurance: 0.65, recovery: 0.5 };

/** kJ of a planned session: from the workout's segments × FTP, else minutes × FTP × a typical intensity. */
export function plannedSessionKcal(s: { type: SessionType; durationMin?: number | undefined; segments?: readonly WorkoutSegment[] | undefined }, ftp: number): number {
  if (s.segments?.length) {
    const joules = flatten(s.segments).reduce((sum, step) => sum + step.durSec * (((step.pct + (step.pctEnd ?? step.pct)) / 2) / 100) * ftp, 0);
    return Math.round(joules / 1000);
  }
  const minutes = s.durationMin ?? 60;
  return Math.round((minutes * 60 * TYPE_INTENSITY[s.type] * ftp) / 1000);
}

export interface WeightGoalInput {
  id: string;
  title: string;
  target: number;
  /** Unset on a goal from before paces (DECISIONS #96): the default pace applies. */
  pace?: WeightPace | undefined;
}

/**
 * The pace a weight goal asks for: the pace the athlete picked, toward the target. An older goal
 * with no pace uses the default. Clamped to 1.0 kg/week loss, 0.5 gain, though every listed pace
 * for the direction fits (DECISIONS #96).
 */
export function goalPace(goal: WeightGoalInput | undefined, trendKg: number | undefined, today: IsoDate, defaultKgPerWeek: number): GoalPace {
  if (!goal || trendKg == null) return { kgPerWeek: 0, kcalPerDay: 0, mode: 'maintain', ...(goal ? { goalId: goal.id, title: goal.title, note: 'No trend weight yet' } : {}) };
  const base = { goalId: goal.id, title: goal.title, targetKg: goal.target, ...(goal.pace ? { pace: goal.pace } : {}), trendKg };
  const diff = goal.target - trendKg;
  if (Math.abs(diff) <= REACHED_KG) return { ...base, kgPerWeek: 0, kcalPerDay: 0, mode: 'reached', note: 'At target — maintaining' };
  const rate = Math.sign(diff) * (goal.pace ? paceKgPerWeek(goal.pace) : defaultKgPerWeek);
  let note = goal.pace ? undefined : `No pace set — ${defaultKgPerWeek} kg/week`;
  const clamped = Math.max(-MAX_LOSS_PER_WEEK, Math.min(MAX_GAIN_PER_WEEK, rate));
  if (clamped !== rate) note = `Capped at ${Math.abs(clamped)} kg/week`;
  const kgPerWeek = Math.round(clamped * 100) / 100;
  const etaDate = weightEta(trendKg, goal.target, kgPerWeek, today);
  return {
    ...base,
    kgPerWeek,
    kcalPerDay: round5((kgPerWeek * KCAL_PER_KG) / 7),
    mode: kgPerWeek < 0 ? 'lose' : 'gain',
    ...(etaDate ? { etaDate } : {}),
    ...(note ? { note } : {}),
  };
}

export function macroTargets(totalKcal: number, weightKg: number, s: Pick<ResolvedEnergySettings, 'proteinGPerKg' | 'fatGPerKg'>): MacroTargets {
  const proteinG = Math.round(s.proteinGPerKg * weightKg);
  const fatG = Math.round(s.fatGPerKg * weightKg);
  return { proteinG, fatG, carbsG: Math.max(0, Math.round((totalKcal - proteinG * 4 - fatG * 9) / 4)) };
}

export interface PlannedSession {
  id: string;
  title: string;
  type: SessionType;
  durationMin?: number | undefined;
  segments?: readonly WorkoutSegment[] | undefined;
}

export interface BudgetInputs {
  date: IsoDate;
  today: IsoDate;
  settings: EnergySettings;
  /** For steps and macros — a fallback when there's no trend weight yet. */
  weightKg: number;
  /** The trend weight the goal is measured from; without one the goal can't set a pace (maintain). */
  trendKg?: number | undefined;
  ftp: number;
  /** Daily steps covering at least the 14 days before `date` and the date itself. */
  steps: readonly StepDay[];
  /** Activities on the date. */
  activities: readonly Activity[];
  /** Sessions on the date still planned (not done, skipped or missed) — projected until ridden. */
  planned: readonly PlannedSession[];
  goal: WeightGoalInput | undefined;
  dataWarning?: string | undefined;
}

/** Steps to count for a day: actual for past days; today the larger of the average and the count so far. */
export function stepsForDay(steps: readonly StepDay[], date: IsoDate, today: IsoDate): EnergyBudget['steps'] {
  const from = addDays(date, -STEPS_AVERAGE_DAYS);
  const window = steps.filter((s) => s.date >= from && s.date < date);
  const average = window.length >= 3 ? Math.round(window.reduce((n, s) => n + s.steps, 0) / window.length) : undefined;
  const actual = steps.find((s) => s.date === date)?.steps;
  if (date < today) return actual != null ? { today: actual, average, used: actual, basis: 'actual' } : average != null ? { average, used: average, basis: 'average' } : undefined;
  if (average == null) return actual != null ? { today: actual, used: actual, basis: 'actual' } : undefined;
  return actual != null && actual > average ? { today: actual, average, used: actual, basis: 'actual' } : { ...(actual != null ? { today: actual } : {}), average, used: average, basis: 'average' };
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** "−1 lb/week", "+0.25 kg/week": the picked pace when it's what applies, else the kg/week in use. */
export function paceNote(goal: Pick<GoalPace, 'pace' | 'kgPerWeek' | 'note'>): string {
  const sign = goal.kgPerWeek > 0 ? '+' : '−';
  if (goal.pace && !goal.note) return `${sign}${paceLabel(goal.pace)}`;
  return `${sign}${Math.abs(goal.kgPerWeek)} kg/week`;
}

export function dailyBudget(i: BudgetInputs): EnergyBudget {
  const s = energyDefaults(i.settings);
  const exercise: BudgetExercise[] = [];
  for (const a of i.activities) {
    const k = exerciseKcal(a, s.exerciseSource);
    if (k) exercise.push({ name: a.name, kcal: k.kcal, basis: k.basis, ref: a.id, startLocal: a.startLocal });
  }
  if (i.date >= i.today) {
    for (const p of i.planned) exercise.push({ name: p.title, kcal: plannedSessionKcal(p, i.ftp), basis: 'planned', ref: p.id });
  }
  const exerciseTotal = exercise.reduce((n, e) => n + e.kcal, 0);
  const hardDay = exerciseTotal >= HARD_DAY_KCAL || i.activities.some((a) => a.isRace) || i.planned.some((p) => p.type === 'race');
  const goal = goalPace(i.goal, 'trendKg' in i ? i.trendKg : i.weightKg, i.today, s.defaultKgPerWeek);
  const protectedDay = s.protectHardDays && hardDay && goal.kcalPerDay < 0;
  const steps = s.activityMode === 'steps' ? stepsForDay(i.steps, i.date, i.today) : undefined;

  if (!s.bmrKcal) {
    return { date: i.date, ready: false, lines: [], total: 0, exercise, goal, hardDay, protectedDay, steps, ...(i.dataWarning ? { dataWarning: i.dataWarning } : {}) };
  }
  const bmr = s.bmrKcal;
  const lines: BudgetLine[] = [{ key: 'base', label: 'RMR', kcal: bmr, note: s.bmrSource === 'scan' ? 'from your body scan' : s.bmrSource === 'measured' ? 'measured' : '' }];
  if (steps) {
    const walk = stepsKcal(steps.used, i.weightKg);
    lines.push({
      key: 'activity',
      label: 'Daily activity',
      kcal: Math.round(bmr * LIVING_FACTOR) + walk,
      note: `${fmt(steps.used)} steps${steps.basis === 'average' ? ` (${STEPS_AVERAGE_DAYS}-day avg)` : ''} + everyday living`,
    });
  } else {
    const factor = s.activityMode === 'factor' ? s.activityFactor : ENERGY_DEFAULTS.activityFactor;
    lines.push({ key: 'activity', label: 'Daily activity', kcal: Math.round(bmr * (factor - 1)), note: s.activityMode === 'factor' ? `× ${factor} activity factor` : `no step data — × ${factor} average day` });
  }
  lines.push({
    key: 'exercise',
    label: 'Exercise',
    kcal: exerciseTotal,
    note: exercise.length ? exercise.map((e) => `${e.name.replace(/^Zwift - /, '')}${e.basis === 'planned' ? ' (planned)' : ''}`).join(', ') : 'none',
  });
  const goalKcal = protectedDay ? 0 : goal.kcalPerDay;
  lines.push({
    key: 'goal',
    label: 'Goal',
    kcal: goalKcal,
    note: protectedDay ? 'hard day — no deficit' : goal.mode === 'maintain' ? 'maintain' : goal.mode === 'reached' ? 'at target — maintain' : paceNote(goal),
  });
  const total = lines.reduce((n, l) => n + l.kcal, 0);
  return {
    date: i.date,
    ready: true,
    lines,
    total,
    exercise,
    goal,
    hardDay,
    protectedDay,
    steps,
    macros: macroTargets(total, i.weightKg, s),
    ...(i.dataWarning ? { dataWarning: i.dataWarning } : {}),
  };
}
