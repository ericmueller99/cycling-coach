import { dailyBudget } from '@cycling-coach/core';
import type { EnergyBudget, EnergySettings, IsoDate } from '@cycling-coach/shared';
import { useEnergy, useEnergyBudget } from './foodQueries';

/**
 * A rest day's budget (no rides) from the same core maths as the real one: average steps, the
 * weight goal's pace. `settings` may carry unsaved edits (the budget card previews them).
 */
export function restDayBudget(settings: EnergySettings, b: EnergyBudget): EnergyBudget {
  const steps = b.steps?.average != null ? [{ date: '2000-01-01', steps: b.steps.average }] : [];
  return dailyBudget({
    date: '2000-01-01',
    today: '2000-01-01',
    settings,
    weightKg: b.weightKg ?? 75,
    ftp: b.ftp ?? 250,
    steps,
    activities: [],
    planned: [],
    goal: b.goal.goalId ? { id: b.goal.goalId, title: b.goal.title ?? '', target: b.goal.targetKg!, ...(b.goal.pace ? { pace: b.goal.pace } : {}) } : undefined,
  });
}

/** Today's rest-day budget, or undefined until loaded / while RMR isn't set. */
export function useRestDayBudget(today: IsoDate): EnergyBudget | undefined {
  const energy = useEnergy();
  const budget = useEnergyBudget(today);
  if (!energy.data || !budget.data) return undefined;
  const rest = restDayBudget(energy.data.settings, budget.data);
  return rest.ready ? rest : undefined;
}
