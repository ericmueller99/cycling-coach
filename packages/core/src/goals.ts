import type { Goal, GoalProgress, PowerBest } from '@cycling-coach/shared';

export interface GoalSnapshot {
  ftp: number;
  /** Trend weight. */
  weightKg: number;
  zwiftWeightKg?: number | undefined;
  /** Zwift's own metrics, when synced or entered. */
  zftp?: number | undefined;
  zmap?: number | undefined;
  powerBests: readonly PowerBest[];
  ctl?: number | undefined;
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
  switch (measure.kind) {
    case 'wkg': {
      const zwift = measure.weight === 'zwift' && s.zwiftWeightKg !== undefined;
      current = round(s.ftp / (zwift ? s.zwiftWeightKg! : s.weightKg), 2);
      unit = 'W/kg';
      label = zwift ? 'W/kg (Zwift weight)' : 'W/kg (trend weight)';
      break;
    }
    case 'zwift_wkg': {
      const watts = measure.metric === 'zftp' ? s.zftp : s.zmap;
      const zwift = s.zwiftWeightKg !== undefined;
      current = watts !== undefined ? round(watts / (zwift ? s.zwiftWeightKg! : s.weightKg), 2) : undefined;
      unit = 'W/kg';
      label = `${measure.metric === 'zftp' ? 'zFTP' : 'zMAP'} W/kg (${zwift ? 'Zwift' : 'trend'} weight)`;
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
  return { current, target, unit, fraction, label };
}
