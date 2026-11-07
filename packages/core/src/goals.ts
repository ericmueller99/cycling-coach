import type { Goal, GoalProgress, IsoDate, PowerBest, WeightPace } from '@cycling-coach/shared';
import { addDays } from './dates';

export interface GoalSnapshot {
  /** Unset until the athlete knows their FTP (DECISIONS #62). */
  ftp?: number | undefined;
  /** Trend weight. */
  weightKg: number;
  zwiftWeightKg?: number | undefined;
  /** Zwift's own metrics, when synced or entered. */
  zftp?: number | undefined;
  zmap?: number | undefined;
  powerBests: readonly PowerBest[];
  ctl?: number | undefined;
}

/**
 * Whether a goal's date means anything: only an event's. Every other goal is open-ended (DECISIONS #86),
 * and a weight goal has a pace instead (#96); a date an older one still has is ignored.
 */
export function goalTakesDate(goal: Pick<Goal, 'event'>): boolean {
  return goal.event === true;
}

export const KG_PER_LB = 0.45359237;
/** Weeks in a month, for a monthly pace. */
const WEEKS_PER_MONTH = 52 / 12;

/** A weight goal's pace in kg per week, always positive (the direction comes from the target). */
export function paceKgPerWeek(pace: WeightPace): number {
  return (pace.amount * (pace.unit === 'lb' ? KG_PER_LB : 1)) / (pace.per === 'month' ? WEEKS_PER_MONTH : 1);
}

/** "1 lb/week", "4 kg/month". */
export function paceLabel(pace: WeightPace): string {
  return `${pace.amount} ${pace.unit}/${pace.per}`;
}

/** The day a weight target is reached at a steady rate from today's trend weight; undefined with no rate. */
export function weightEta(trendKg: number, targetKg: number, kgPerWeek: number, today: IsoDate): IsoDate | undefined {
  if (kgPerWeek === 0 || Math.sign(targetKg - trendKg) !== Math.sign(kgPerWeek)) return undefined;
  return addDays(today, Math.ceil((Math.abs(targetKg - trendKg) / Math.abs(kgPerWeek)) * 7));
}

const PERIOD: Record<PowerBest['period'], string> = { '90d': '90 days', season: 'season', allTime: 'all-time' };
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const durationLabel = (sec: number) => (sec < 60 ? `${sec} s` : `${sec / 60} min`);

/**
 * A goal's live progress from current data. Goals store what they measure and a target, never a
 * current value, so they can't go stale. Undefined when the goal isn't measurable or the data
 * isn't there yet.
 */
export function goalProgress(goal: Pick<Goal, 'measure' | 'target'>, s: GoalSnapshot): GoalProgress | undefined {
  const { measure, target } = goal;
  if (!measure || target === undefined || target <= 0) return undefined;

  let current: number | undefined;
  let unit: string;
  let label: string;
  let lowerIsBetter = false;
  let onTrendWeight = false;
  switch (measure.kind) {
    case 'wkg': {
      const zwift = measure.weight === 'zwift' && s.zwiftWeightKg !== undefined;
      current = s.ftp !== undefined ? round(s.ftp / (zwift ? s.zwiftWeightKg! : s.weightKg), 2) : undefined;
      unit = 'W/kg';
      label = zwift ? 'W/kg (Zwift weight)' : 'W/kg (trend weight)';
      onTrendWeight = !zwift;
      break;
    }
    case 'zwift_wkg': {
      const watts = measure.metric === 'zftp' ? s.zftp : s.zmap;
      const zwift = s.zwiftWeightKg !== undefined;
      current = watts !== undefined ? round(watts / (zwift ? s.zwiftWeightKg! : s.weightKg), 2) : undefined;
      unit = 'W/kg';
      label = `${measure.metric === 'zftp' ? 'zFTP' : 'zMAP'} W/kg (${zwift ? 'Zwift' : 'trend'} weight)`;
      onTrendWeight = !zwift;
      break;
    }
    case 'ftp':
      current = s.ftp;
      unit = 'W';
      label = 'FTP';
      break;
    case 'power_best':
      current = s.powerBests.find((b) => b.period === measure.period && b.durationSec === measure.durationSec)?.watts;
      unit = 'W';
      label = `${durationLabel(measure.durationSec)} best (${PERIOD[measure.period]})`;
      break;
    case 'weight':
      current = s.weightKg;
      unit = 'kg';
      label = 'Trend weight';
      lowerIsBetter = true;
      onTrendWeight = true;
      break;
    case 'fitness':
      current = s.ctl !== undefined ? round(s.ctl, 1) : undefined;
      unit = 'CTL';
      label = 'Fitness';
      break;
    case 'manual':
      current = measure.current;
      unit = measure.unit;
      label = measure.unit;
      break;
  }
  if (current === undefined || current <= 0) return undefined;
  const fraction = Math.max(0, Math.min(1, lowerIsBetter ? target / current : current / target));
  return { current, target, unit, fraction, label, ...(onTrendWeight ? { onTrendWeight } : {}) };
}
