import { powerBestDurations, type Goal, type GoalMeasure, type PowerBest } from '@cycling-coach/shared';
import { useEffect, useState } from 'react';
import { PencilIcon, TrashIcon } from '../../components/icons';
import { Button, Card, ErrorNote, ProgressBar, SectionLabel } from '../../components/ui';
import { describeMeasure, measureUnit } from '../../lib/goals';
import { errorMessage, useProfileMutations } from '../../lib/queries';
import { durLabel, PERIODS } from './shared';

type MeasureChoice = 'none' | 'zftp_wkg' | 'zmap_wkg' | 'wkg_zwift' | 'wkg_trend' | 'ftp' | 'power_best' | 'weight' | 'fitness' | 'manual';

function measureFromChoice(choice: MeasureChoice, extra: { durationSec: number; period: PowerBest['period']; current: number; unit: string }): GoalMeasure | undefined {
  switch (choice) {
    case 'none':
      return undefined;
    case 'wkg_zwift':
      return { kind: 'wkg', weight: 'zwift' };
    case 'wkg_trend':
      return { kind: 'wkg', weight: 'trend' };
    case 'zftp_wkg':
      return { kind: 'zwift_wkg', metric: 'zftp' };
    case 'zmap_wkg':
      return { kind: 'zwift_wkg', metric: 'zmap' };
    case 'power_best':
      return { kind: 'power_best', durationSec: extra.durationSec, period: extra.period };
    case 'manual':
      return { kind: 'manual', current: extra.current, unit: extra.unit || 'units' };
    default:
      return { kind: choice };
  }
}

function choiceFromMeasure(m: GoalMeasure | undefined): MeasureChoice {
  if (!m) return 'none';
  if (m.kind === 'wkg') return m.weight === 'zwift' ? 'wkg_zwift' : 'wkg_trend';
  if (m.kind === 'zwift_wkg') return m.metric === 'zftp' ? 'zftp_wkg' : 'zmap_wkg';
  return m.kind;
}

/** Add or edit a goal: what it's measured by and a target — never a current value. */
function GoalEditor({ goal, preset, onDone }: { goal?: Goal; preset?: MeasureChoice | undefined; onDone: () => void }) {
  const { createGoal, updateGoal } = useProfileMutations();
  const [horizon, setHorizon] = useState<Goal['horizon']>(goal?.horizon ?? 'long');
  const [title, setTitle] = useState(goal?.title ?? (preset === 'weight' ? 'Race weight' : ''));
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [detail, setDetail] = useState(goal?.detail ?? '');
  const [targetLabel, setTargetLabel] = useState(goal?.targetLabel ?? '');
  const [choice, setChoice] = useState<MeasureChoice>(goal ? choiceFromMeasure(goal.measure) : (preset ?? 'none'));
  const [target, setTarget] = useState(goal?.target?.toString() ?? '');
  const [durationSec, setDurationSec] = useState(goal?.measure?.kind === 'power_best' ? goal.measure.durationSec : 300);
  const [period, setPeriod] = useState<PowerBest['period']>(goal?.measure?.kind === 'power_best' ? goal.measure.period : '90d');
  const [manualCurrent, setManualCurrent] = useState(goal?.measure?.kind === 'manual' ? String(goal.measure.current) : '');
  const [manualUnit, setManualUnit] = useState(goal?.measure?.kind === 'manual' ? goal.measure.unit : '');
  const field = 'min-h-10 rounded-lg border border-line-strong px-2';

  const save = () => {
    const measure = measureFromChoice(choice, { durationSec, period, current: Number(manualCurrent) || 0, unit: manualUnit });
    const fields = {
      horizon,
      title,
      ...(detail ? { detail } : {}),
      ...(targetLabel ? { targetLabel } : {}),
      ...(targetDate ? { targetDate } : {}),
      ...(measure && target !== '' ? { measure, target: Number(target) } : {}),
    };
    if (goal) {
      const unset = [
        ...(!detail ? (['detail'] as const) : []),
        ...(!targetLabel ? (['targetLabel'] as const) : []),
        ...(!targetDate ? (['targetDate'] as const) : []),
        ...(!fields.measure ? (['measure', 'target'] as const) : []),
      ];
      updateGoal.mutate({ id: goal.id, patch: { ...fields, ...(unset.length ? { unset } : {}) } }, { onSuccess: onDone });
    } else {
      createGoal.mutate({ ...fields, done: false, primary: false }, { onSuccess: onDone });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
      <div className="flex gap-2">
        <select value={horizon} onChange={(e) => setHorizon(e.target.value as Goal['horizon'])} className={field}>
          <option value="long">Long term</option>
          <option value="short">Short term</option>
        </select>
        <input placeholder="Goal" value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} flex-1`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <input placeholder="Detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} className={`${field} flex-1`} />
        <input placeholder="When, e.g. Sept 2027" value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)} className={`${field} w-40`} />
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          By
          <input type="date" aria-label="Target date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={field} />
        </label>
      </div>
      {choice === 'weight' && (
        <div className="text-xs text-muted">
          A weight goal sets your calorie budget: the deficit (or surplus) to reach it by the date, or your default pace without one.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">Measured by</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value as MeasureChoice)} className={field}>
          <option value="none">Nothing (not numeric)</option>
          <option value="zftp_wkg">zFTP W/kg (Zwift categories)</option>
          <option value="zmap_wkg">zMAP W/kg (Zwift categories)</option>
          <option value="wkg_zwift">W/kg on Zwift weight</option>
          <option value="wkg_trend">W/kg on trend weight</option>
          <option value="ftp">FTP</option>
          <option value="power_best">A power best</option>
          <option value="weight">Trend weight</option>
          <option value="fitness">Fitness (CTL)</option>
          <option value="manual">Something else (by hand)</option>
        </select>
        {choice === 'power_best' && (
          <>
            <select value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value))} className={field}>
              {powerBestDurations.map((d) => (
                <option key={d} value={d}>
                  {durLabel(d)}
                </option>
              ))}
            </select>
            <select value={period} onChange={(e) => setPeriod(e.target.value as PowerBest['period'])} className={field}>
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}
        {choice === 'manual' && (
          <>
            <input placeholder="Current" type="number" value={manualCurrent} onChange={(e) => setManualCurrent(e.target.value)} className={`${field} w-24`} />
            <input placeholder="Unit" value={manualUnit} onChange={(e) => setManualUnit(e.target.value)} className={`${field} w-24`} />
          </>
        )}
        {choice !== 'none' && (
          <>
            <span className="text-muted">target</span>
            <input type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} className={`${field} w-24 font-mono`} />
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={!title || createGoal.isPending || updateGoal.isPending} onClick={save}>
          {goal ? 'Save goal' : 'Add goal'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {(createGoal.error || updateGoal.error) && <ErrorNote>{errorMessage(createGoal.error ?? updateGoal.error)}</ErrorNote>}
    </div>
  );
}

function GoalRow({ goal, main }: { goal: Goal; main: boolean }) {
  const { updateGoal, deleteGoal } = useProfileMutations();
  const [editing, setEditing] = useState(false);
  if (editing) return <GoalEditor goal={goal} onDone={() => setEditing(false)} />;
  const actions = (
    <>
      <button type="button" aria-label="Edit goal" onClick={() => setEditing(true)} className="border-0 bg-transparent text-muted">
        <PencilIcon />
      </button>
      <button type="button" aria-label="Delete goal" onClick={() => deleteGoal.mutate(goal.id)} className="border-0 bg-transparent text-muted">
        <TrashIcon />
      </button>
    </>
  );
  if (goal.horizon === 'short' && !goal.progress) {
    return (
      <div className="flex min-h-10 items-center gap-2.5">
        <input
          type="checkbox"
          checked={goal.done}
          onChange={(e) => updateGoal.mutate({ id: goal.id, patch: { done: e.target.checked } })}
          className="h-[18px] w-[18px] accent-accent-ink"
          aria-label={goal.title}
        />
        <span className={`flex-1 ${goal.done ? 'text-muted line-through' : ''}`}>{goal.title}</span>
        {actions}
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 ${main ? 'border-accent-ring bg-accent-tint' : 'border-line bg-surface-2'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2 font-semibold">
          {goal.title}
          {main && <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-on-accent">Main goal</span>}
        </span>
        <span className="flex flex-none items-center gap-2 text-xs text-muted">
          {goal.targetLabel}
          {!main && goal.horizon === 'long' && (
            <Button size="sm" variant="ghost" className="min-h-7! px-2! text-xs" onClick={() => updateGoal.mutate({ id: goal.id, patch: { primary: true } })}>
              Make main
            </Button>
          )}
          {actions}
        </span>
      </div>
      {goal.detail && <div className="text-xs text-muted">{goal.detail}</div>}
      {goal.progress ? (
        <>
          <ProgressBar value={goal.progress.fraction} height={6} />
          <div className="flex justify-between font-mono text-[11px] text-muted">
            <span>
              now {goal.progress.current} {goal.progress.unit} · {goal.progress.label}
            </span>
            <span>target {goal.progress.target}</span>
          </div>
        </>
      ) : goal.measure && goal.target !== undefined ? (
        <div className="font-mono text-[11px] text-muted">
          {describeMeasure(goal.measure)} → {goal.target} {measureUnit(goal.measure)} · no data yet
        </div>
      ) : null}
    </div>
  );
}

const Empty = ({ children }: { children: string }) => (
  <div className="rounded-[10px] border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">{children}</div>
);

/**
 * Goals. `mainId` is the goal the coach treats as main — the primary one, else the
 * dashboard's fallback (the first long-term goal), so exactly one card carries the badge.
 */
export function GoalsSection({ goals, mainId, addWeightGoal, onAddedWeightGoal }: { goals: Goal[]; mainId: string | undefined; addWeightGoal?: boolean; onAddedWeightGoal?: () => void }) {
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (addWeightGoal) setAdding(true);
  }, [addWeightGoal]);
  const close = () => {
    setAdding(false);
    onAddedWeightGoal?.();
  };
  const long = goals.filter((g) => g.horizon === 'long');
  const short = goals.filter((g) => g.horizon === 'short');
  return (
    <Card className="flex flex-col gap-3.5 p-[18px]">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-base">Goals</h2>
        <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)}>
          + Add goal
        </Button>
      </div>
      {adding && <GoalEditor preset={addWeightGoal ? 'weight' : undefined} onDone={close} />}
      <SectionLabel>Long term</SectionLabel>
      {long.length ? long.map((g) => <GoalRow key={g.id} goal={g} main={g.id === mainId} />) : <Empty>No long-term goals yet.</Empty>}
      <SectionLabel>Short term</SectionLabel>
      {short.length ? short.map((g) => <GoalRow key={g.id} goal={g} main={g.id === mainId} />) : <Empty>Nothing short-term. Add one for this block, e.g. "Hold 400 W for 5 min".</Empty>}
      <div className="text-xs text-muted">
        Goals can be measured by power at a duration, FTP or W/kg, Zwift W/kg, trend weight, fitness (CTL) or by hand. The main goal leads the coach's context.
      </div>
    </Card>
  );
}
