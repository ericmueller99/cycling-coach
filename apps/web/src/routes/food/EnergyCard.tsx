import { macroSplit } from '@cycling-coach/core';
import type { EnergyBudget, Nutrients } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { KcalBar } from '../../components/KcalBar';
import { Card } from '../../components/ui';
import { approx, includesEstimates, fmtG, fmtKcal, MACRO_COLOR } from '../../lib/food';

const MACROS = [
  { key: 'protein', label: 'Protein', target: 'proteinG' },
  { key: 'carbs', label: 'Carbs', target: 'carbsG' },
  { key: 'fat', label: 'Fat', target: 'fatG' },
] as const;

const signed = (n: number) => `${n < 0 ? '−' : ''}${fmtKcal(Math.abs(n))}`;
const pct = (v: number, t: number) => (t > 0 ? Math.min(100, Math.round((v / t) * 100)) : 0);

function SettingsLink({ children = 'Settings' }: { children?: string }) {
  return (
    <Link to="/athlete/$tab" params={{ tab: 'body' }} className="text-[13px]">
      {children}
    </Link>
  );
}

/**
 * Energy today: kcal left, eaten vs budget, and where the budget comes from. The
 * settings live on the Athlete page.
 */
export function EnergyCard({ budget, eaten, estimates, isToday }: { budget: EnergyBudget | undefined; eaten: number; estimates: number; isToday: boolean }) {
  if (!budget) return null;
  if (!budget.ready) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="m-0 text-[15px]">Energy {isToday ? 'today' : 'this day'}</h2>
        <div className="text-[13px] text-muted">Set your RMR on the Athlete page to see how much is left to eat — rides and steps are added automatically.</div>
        <SettingsLink>Set RMR →</SettingsLink>
      </Card>
    );
  }
  const left = budget.total - eaten;
  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-[15px]">Energy {isToday ? 'today' : 'this day'}</h2>
        <SettingsLink />
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-[34px] leading-none font-semibold ${left < 0 ? 'text-danger' : ''}`}>
          {approx(estimates)}
          {signed(left)}
        </span>
        <span className="text-muted">{left < 0 ? 'kcal over' : 'kcal left'}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <KcalBar eaten={eaten} budget={budget.total} className="h-3 rounded-md" />
        <div className="flex justify-between text-xs text-muted">
          <span>
            <strong className="text-ink">
              {approx(estimates)}
              {fmtKcal(eaten)}
            </strong>{' '}
            eaten
          </span>
          <span>
            <strong className="text-ink">{fmtKcal(budget.total)}</strong> budget
          </span>
        </div>
        {estimates > 0 && <div className="text-xs text-muted">{includesEstimates(estimates)}</div>}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-divider pt-2.5 text-[13px]">
        {budget.lines.map((l) => (
          <div key={l.key} className="flex justify-between gap-3">
            <span className="min-w-0 text-muted">
              {l.label} {l.note && <span className="text-[11px]">· {l.note}</span>}
            </span>
            <span className="font-mono">{l.key === 'goal' ? signed(l.kcal) : fmtKcal(l.kcal)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-divider pt-1.5 font-semibold">
          <span>Budget</span>
          <span className="font-mono">{fmtKcal(budget.total)}</span>
        </div>
      </div>
      <div className="text-xs text-muted">
        {budget.exercise.some((e) => e.basis === 'planned') ? 'Planned sessions count until the ride syncs. ' : ''}
        Exercise and steps update from intervals.icu.
      </div>
      {budget.dataWarning && <div className="text-xs text-[#9A5B13]">{budget.dataWarning}</div>}
    </Card>
  );
}

/** Macros eaten vs targets (protein and fat by body weight, carbs fill the budget). */
export function MacrosCard({ total, budget }: { total: Nutrients; budget: EnergyBudget | undefined }) {
  const targets = budget?.macros;
  const split = macroSplit(total);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="m-0 text-[15px]">Macros</h2>
      {MACROS.map((m) => (
        <div key={m.key} className="flex flex-col gap-1">
          <div className="flex justify-between text-[13px]">
            <span>{m.label}</span>
            <span className="font-mono text-muted">
              <strong className="text-ink">{fmtG(total[m.key])}</strong>
              {targets ? ` / ${targets[m.target]} g` : ` g · ${Math.round(split[m.key] * 100)}%`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-hover">
            <div className="h-full" style={{ width: `${targets ? pct(total[m.key], targets[m.target]) : split[m.key] * 100}%`, background: MACRO_COLOR[m.key] }} />
          </div>
        </div>
      ))}
      {(total.fibre != null || total.sugars != null || total.sodiumMg != null) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-divider pt-2.5 text-xs text-muted">
          {total.fibre != null && <span>Fibre {fmtG(total.fibre)} g</span>}
          {total.sugars != null && <span>Sugars {fmtG(total.sugars)} g</span>}
          {total.sodiumMg != null && <span>Sodium {Math.round(total.sodiumMg)} mg</span>}
        </div>
      )}
      {targets && <div className="text-xs text-muted">Targets from the Athlete page: protein and fat by body weight, carbs fill the rest of the budget.</div>}
    </Card>
  );
}

/** The phone summary block: kcal left, eaten / budget, mini macro bars. */
export function MobileEnergy({ total, budget, estimates, isToday }: { total: Nutrients; budget: EnergyBudget | undefined; estimates: number; isToday: boolean }) {
  const ready = budget?.ready;
  const left = ready ? budget.total - total.kcal : 0;
  return (
    <div className="flex flex-col gap-2.5 border-b border-line bg-surface px-4 pt-1 pb-3.5">
      <div className="flex items-end justify-between">
        <div>
          <div className={`font-mono text-[30px] leading-[1.1] font-semibold ${ready && left < 0 ? 'text-danger' : ''}`}>
            {approx(estimates)}
            {ready ? signed(left) : fmtKcal(total.kcal)}
          </div>
          <div className="text-xs text-muted">
            {ready ? `${left < 0 ? 'kcal over' : 'kcal left'}${isToday ? ' today' : ''}` : 'kcal eaten'}
            {estimates > 0 ? ` · ${includesEstimates(estimates)}` : ''}
          </div>
        </div>
        {ready ? (
          <Link to="/athlete/$tab" params={{ tab: 'body' }} className="text-right text-xs text-muted no-underline">
            <strong className="text-ink">
              {approx(estimates)}
              {fmtKcal(total.kcal)}
            </strong>{' '}
            eaten
            <br />
            <strong className="text-ink">{fmtKcal(budget.total)}</strong> budget
          </Link>
        ) : (
          <Link to="/athlete/$tab" params={{ tab: 'body' }} className="text-xs">
            Set RMR for a budget
          </Link>
        )}
      </div>
      {ready && (
        <KcalBar eaten={total.kcal} budget={budget.total} className="h-2.5 rounded-[5px]" />
      )}
      <div className="grid grid-cols-3 gap-2 text-[11px] text-muted">
        {MACROS.map((m) => (
          <div key={m.key}>
            <div className="flex justify-between">
              <span>{m.label}</span>
              <span className="font-mono">
                {fmtG(total[m.key])}
                {budget?.macros ? `/${budget.macros[m.target]}` : ' g'}
              </span>
            </div>
            <div className="mt-[3px] h-1 rounded-sm bg-hover">
              <div className="h-full rounded-sm" style={{ width: `${budget?.macros ? pct(total[m.key], budget.macros[m.target]) : macroSplit(total)[m.key] * 100}%`, background: MACRO_COLOR[m.key] }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
