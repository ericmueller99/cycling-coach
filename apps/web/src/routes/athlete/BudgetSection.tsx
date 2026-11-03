import { energyDefaults, formatShortDate, HARD_DAY_KCAL, LIVING_FACTOR, STEPS_AVERAGE_DAYS, stepsKcal, type ResolvedEnergySettings } from '@cycling-coach/core';
import type { EnergyBudget, EnergyPatch } from '@cycling-coach/shared';
import { useEffect, useId, useState } from 'react';
import { Button, Card, ErrorNote, Segmented, Spinner, inputCls } from '../../components/ui';
import { restDayBudget } from '../../lib/budget';
import { fmtKcal } from '../../lib/food';
import { useEnergy, useEnergyBudget, useEnergyMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { SwitchRow } from '../events/controls';

type Draft = Pick<ResolvedEnergySettings, 'activityMode' | 'activityFactor' | 'exerciseSource' | 'protectHardDays' | 'defaultKgPerWeek' | 'proteinGPerKg' | 'fatGPerKg'>;
const KEYS = ['activityMode', 'activityFactor', 'exerciseSource', 'protectHardDays', 'defaultKgPerWeek', 'proteinGPerKg', 'fatGPerKg'] as const;

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtKcal(Math.abs(n))}`;

function GoalBlock({ b, onAddWeightGoal }: { b: EnergyBudget; onAddWeightGoal: () => void }) {
  const g = b.goal;
  if (!g.goalId) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[13px]">
        <span className="flex-auto">
          <strong>No weight goal — maintaining.</strong> <span className="text-muted">Add one under Goals and the budget sets the deficit for you.</span>
        </span>
        <Button size="sm" onClick={onAddWeightGoal}>
          Add a weight goal
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] bg-accent-tint px-3 py-2.5 text-[13px]">
      <div>
        <strong>{g.title}</strong>: {g.targetKg} kg{g.targetDate ? ` by ${formatShortDate(g.targetDate)}` : ''} · now {g.trendKg} kg (trend)
      </div>
      <div className="font-mono">
        {g.mode === 'reached' ? 'At target — maintaining' : `${g.kgPerWeek > 0 ? '+' : ''}${g.kgPerWeek} kg/week · ${signed(g.kcalPerDay)} kcal/day`}
      </div>
      {g.note && <div className="text-xs text-muted">{g.note}</div>}
    </div>
  );
}

/**
 * Daily calorie budget (Athlete › Body & energy, DECISIONS #36): how the calendar's
 * "kcal left" is built. The goal comes from Goals; daily activity from steps (via intervals.icu); exercise from ride kJ.
 */
export function BudgetSection({ today, onAddWeightGoal }: { today: string; onAddWeightGoal: () => void }) {
  const id = useId();
  const energy = useEnergy();
  const budget = useEnergyBudget(today);
  const m = useEnergyMutations();
  const settings = energy.data ? energyDefaults(energy.data.settings) : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  // Re-seed the draft only when the saved settings change (not on every render).
  const savedAt = energy.data?.settings.updatedAt ?? (energy.data ? 'none' : undefined);
  useEffect(() => {
    if (energy.data) {
      const s = energyDefaults(energy.data.settings);
      setDraft(Object.fromEntries(KEYS.map((k) => [k, s[k]])) as Draft);
    }
  }, [savedAt]);

  if (energy.isPending || budget.isPending || !draft || !settings) return <Spinner />;
  if (energy.error || budget.error) return <ErrorNote>{errorMessage(energy.error ?? budget.error)}</ErrorNote>;
  const b = budget.data!;
  const dirty = KEYS.some((k) => draft[k] !== settings[k]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const save = () => {
    const patch: EnergyPatch = Object.fromEntries(KEYS.filter((k) => draft[k] !== settings[k]).map((k) => [k, draft[k]]));
    m.patch.mutate(patch);
  };

  // The rest-day breakdown, computed in the browser from the same core function with the draft settings.
  const rest = restDayBudget({ ...energy.data!.settings, ...draft }, b);
  const avg = b.steps?.average;

  return (
    <Card className="flex flex-col gap-4 p-[18px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-base">Daily calorie budget</h2>
        <Button variant={dirty ? 'primary' : 'neutral'} size="sm" disabled={!dirty || m.patch.isPending} onClick={save}>
          {m.patch.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>
      {b.ready ? (
        <section className="flex flex-col gap-1 rounded-[12px] bg-surface-2 p-3 text-[13px]">
          {rest.lines
            .filter((l) => l.key !== 'exercise')
            .map((l) => (
              <div key={l.key} className="flex items-baseline justify-between gap-3">
                <span>
                  {l.label} <span className="text-xs text-muted">{l.note}</span>
                </span>
                <span className="font-mono">{l.key === 'base' ? fmtKcal(l.kcal) : signed(l.kcal)}</span>
              </div>
            ))}
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-1.5 font-semibold">
            <span>Rest day</span>
            <span className="font-mono text-base">{fmtKcal(rest.total)} kcal</span>
          </div>
          <div className="text-xs text-muted">+ each ride's energy on training days (≈ its kJ of work).</div>
        </section>
      ) : (
        <div className="rounded-[10px] border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">Set your RMR and the calendar shows how much is left to eat each day.</div>
      )}

      <section className="flex flex-col gap-2">
        <div className="text-[13px] font-semibold">Goal</div>
        <GoalBlock b={b} onAddWeightGoal={onAddWeightGoal} />
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <label htmlFor={`${id}-pace`} className="text-muted">
            Pace when a weight goal has no date
          </label>
          <select id={`${id}-pace`} value={draft.defaultKgPerWeek} onChange={(e) => set('defaultKgPerWeek', Number(e.target.value))} className={`${inputCls} min-h-9`}>
            {[0.25, 0.5, 0.75, 1].map((v) => (
              <option key={v} value={v}>
                {v} kg/week ({signed(-Math.round((v * 7700) / 7))} kcal/day)
              </option>
            ))}
          </select>
        </div>
        <SwitchRow
          on={draft.protectHardDays}
          onChange={(v) => set('protectHardDays', v)}
          label="No deficit on race and hard days"
          hint={`Fuel fully on races and days with ≥ ${fmtKcal(HARD_DAY_KCAL)} kcal of exercise; the deficit applies on the other days.`}
        />
      </section>

      <section className="flex flex-col gap-2 border-t border-divider pt-3.5">
        <div className="text-[13px] font-semibold">Daily activity</div>
        <Segmented
          label="Daily activity"
          value={draft.activityMode}
          options={[
            { key: 'steps', label: 'From your steps' },
            { key: 'factor', label: 'Fixed factor' },
          ]}
          onChange={(v) => set('activityMode', v)}
        />
        {draft.activityMode === 'steps' ? (
          <div className="text-[13px] text-muted">
            {avg != null ? (
              <>
                {STEPS_AVERAGE_DAYS}-day average <strong className="font-mono text-ink">{fmtKcal(avg)}</strong> steps ≈ {fmtKcal(stepsKcal(avg, b.weightKg ?? 75))} kcal/day, plus everyday living (RMR × {LIVING_FACTOR}). From Garmin via intervals.icu — busy days count as they happen.
              </>
            ) : (
              <>No step data from intervals.icu yet — an average day (RMR × 1.3) is used until it arrives.</>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[13px]">
            <label htmlFor={`${id}-factor`} className="text-muted">
              RMR ×
            </label>
            <select id={`${id}-factor`} value={draft.activityFactor} onChange={(e) => set('activityFactor', Number(e.target.value))} className={`${inputCls} min-h-9`}>
              {[1.2, 1.3, 1.4, 1.5].map((v) => (
                <option key={v} value={v}>
                  {v} — {v === 1.2 ? 'desk day' : v === 1.3 ? 'some walking' : v === 1.4 ? 'on your feet' : 'very active'}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">Rides are counted separately.</span>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-divider pt-3.5">
        <div className="text-[13px] font-semibold">Exercise calories</div>
        <Segmented
          label="Exercise calories"
          value={draft.exerciseSource}
          options={[
            { key: 'power', label: 'From power (kJ)' },
            { key: 'device', label: 'Device estimate' },
          ]}
          onChange={(v) => set('exerciseSource', v)}
        />
        <div className="text-xs text-muted">
          {draft.exerciseSource === 'power'
            ? 'kJ of work ≈ kcal burned on the bike (your body is ~24% efficient, and 1 kcal = 4.184 kJ). Activities without power use the device estimate.'
            : 'Calorie estimates from Zwift or your device. Power-based kJ is usually closer for rides.'}{' '}
          Today's planned sessions count until the ride syncs from intervals.icu.
        </div>
      </section>

      <section className="flex flex-col gap-2 border-t border-divider pt-3.5">
        <div className="text-[13px] font-semibold">Macro targets</div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {(
            [
              ['proteinGPerKg', 'Protein'],
              ['fatGPerKg', 'Fat'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <span className="text-muted">{label}</span>
              <input
                type="number"
                step="0.05"
                inputMode="decimal"
                value={draft[k]}
                onChange={(e) => Number(e.target.value) > 0 && set(k, Number(e.target.value))}
                className={`${inputCls} min-h-9 w-20 font-mono`}
              />
              <span className="text-muted">g/kg = {Math.round(draft[k] * (b.weightKg ?? 75))} g</span>
            </label>
          ))}
          <span className="text-xs text-muted">Carbs fill the rest of the budget.</span>
        </div>
      </section>

      <div className="text-xs text-muted">
        Don't apply a scan report's activity multipliers (×1.2–1.9) here: steps and rides are already counted, so they would be counted twice.
      </div>
      {b.dataWarning && <div className="text-xs text-[#9A5B13]">{b.dataWarning}</div>}
      {m.patch.error && <ErrorNote>{errorMessage(m.patch.error)}</ErrorNote>}
    </Card>
  );
}

