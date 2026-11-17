import { sumNutrients } from '@cycling-coach/core';
import type { IsoDate } from '@cycling-coach/shared';
import { fmtKcal } from '../../lib/food';
import { useEnergyBudget, useFoodLog } from '../../lib/foodQueries';

/**
 * What's left in the day's budget now, and after the portion being picked. The same sum as
 * the Energy card; nothing until the budget is ready (RMR set) and the day's log has loaded.
 */
export function KcalLeft({ date, kcal }: { date: IsoDate; kcal: number }) {
  const budget = useEnergyBudget(date).data;
  const dayLog = useFoodLog(date).data;
  if (!budget?.ready || !dayLog) return null;
  const left = Math.round(budget.total - sumNutrients(dayLog.entries.map((e) => e.nutrients)).kcal);
  const after = Math.round(left - kcal);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px] text-muted">
      <span>
        <strong className={`font-mono ${left < 0 ? 'text-danger' : 'text-ink'}`}>{fmtKcal(Math.abs(left))}</strong> kcal {left < 0 ? 'over' : 'left'} now
      </span>
      <span className={after < 0 ? 'text-danger' : ''}>
        <strong className={`font-mono ${after < 0 ? '' : 'text-ink'}`}>{fmtKcal(Math.abs(after))}</strong> {after < 0 ? 'over' : 'left'} after this
      </span>
    </div>
  );
}
