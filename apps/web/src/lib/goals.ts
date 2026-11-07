import { formatShortDate, goalPace, goalTakesDate, paceLabel } from '@cycling-coach/core';
import type { Goal, GoalMeasure, IsoDate } from '@cycling-coach/shared';

const PERIOD: Record<'90d' | 'season' | 'allTime', string> = { '90d': '90 days', season: 'season', allTime: 'all-time' };

/** "Jun 12, 2027" for an event; every other goal shows no date, even one an older goal still stores. */
export function goalDateLabel(goal: Pick<Goal, 'event' | 'targetDate'>): string | undefined {
  if (!goal.targetDate || !goalTakesDate(goal)) return undefined;
  return `${formatShortDate(goal.targetDate)}, ${goal.targetDate.slice(0, 4)}`;
}

/** "Mar 14", with the year when it isn't this year's. */
export function etaLabel(eta: IsoDate, today: IsoDate): string {
  return `${formatShortDate(eta)}${eta.slice(0, 4) === today.slice(0, 4) ? '' : `, ${eta.slice(0, 4)}`}`;
}

/**
 * "1 lb/week · about Mar 14" for a weight goal with a pace (DECISIONS #96): the estimate is from the
 * live trend weight, so it moves with it. Just the pace with no trend weight; nothing without a pace.
 */
export function paceSummary(goal: Pick<Goal, 'id' | 'title' | 'measure' | 'target' | 'pace' | 'progress'>, today: IsoDate): string | undefined {
  if (goal.measure?.kind !== 'weight' || !goal.pace) return undefined;
  const pace = paceLabel(goal.pace);
  if (goal.target === undefined || !goal.progress) return pace;
  const p = goalPace({ id: goal.id, title: goal.title, target: goal.target, pace: goal.pace }, goal.progress.current, today, 0.5);
  if (p.mode === 'reached') return `${pace} · at target`;
  return p.etaDate ? `${pace} · about ${etaLabel(p.etaDate, today)}` : pace;
}

/** "W/kg on Zwift weight", "5 min best (90 days)" — what a goal is measured by, in words. */
export function describeMeasure(m: GoalMeasure): string {
  switch (m.kind) {
    case 'wkg':
      return m.weight === 'zwift' ? 'W/kg on Zwift weight' : 'W/kg on trend weight';
    case 'zwift_wkg':
      return m.metric === 'zftp' ? 'zFTP W/kg on Zwift weight' : 'zMAP W/kg on Zwift weight';
    case 'ftp':
      return 'FTP';
    case 'power_best':
      return `${m.durationSec < 60 ? `${m.durationSec} s` : `${m.durationSec / 60} min`} best (${PERIOD[m.period]})`;
    case 'weight':
      return 'Trend weight';
    case 'fitness':
      return 'Fitness (CTL)';
    case 'manual':
      return `${m.unit} (tracked by hand)`;
  }
}

export function measureUnit(m: GoalMeasure): string {
  switch (m.kind) {
    case 'wkg':
    case 'zwift_wkg':
      return 'W/kg';
    case 'ftp':
    case 'power_best':
      return 'W';
    case 'weight':
      return 'kg';
    case 'fitness':
      return 'CTL';
    case 'manual':
      return m.unit;
  }
}
