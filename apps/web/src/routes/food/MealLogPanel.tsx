import { computePortion, formatQuantity, roundTo, sumNutrients, unitsFor } from '@cycling-coach/core';
import type { FoodLibrary, IsoDate, Meal, Nutrients } from '@cycling-coach/shared';
import { useId, useState } from 'react';
import { XIcon } from '../../components/icons';
import { convertPortion } from '../../components/PortionPicker';
import { Button, ErrorNote, inputCls } from '../../components/ui';
import { findLoggable, fmtKcal, macroLine, nowTime } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';

const SCALES = [0.25, 0.5, 0.75, 1, 1.5, 2];

/**
 * Log a saved meal: every item editable, plus an overall scale for "I only had
 * half". Each item is written as its own entry (`fromMealId`) so one can be tweaked on the day.
 */
export function MealLogPanel({ meal, lib, date, slot, onLogged }: { meal: Meal; lib: FoodLibrary; date: IsoDate; slot: string; onLogged: () => void }) {
  const id = useId();
  const m = useFoodMutations();
  const [scale, setScale] = useState(1);
  const [items, setItems] = useState(() => meal.items.map((it) => ({ ...it, quantity: it.quantity, on: true })));
  // The slot's usual time until the user picks one — so switching Breakfast → Lunch moves the time too.
  const [pickedTime, setTime] = useState<string | null>(null);
  const time = pickedTime ?? lib.settings.slots.find((s) => s.name === slot)?.time ?? nowTime();
  const [error, setError] = useState<string | null>(null);

  const rows = items.map((it) => {
    const item = findLoggable(lib, it.kind, it.refId);
    const priced = item ? computePortion(item, it.quantity * scale, it.unit) : null;
    return { it, item, priced };
  });
  const active = rows.filter((r) => r.it.on && r.priced);
  const total: Nutrients = sumNutrients(active.map((r) => r.priced!.nutrients));

  const log = () =>
    m.log.mutate(
      active.map(({ it }) => ({ date, slot, time, kind: it.kind, refId: it.refId, quantity: roundTo(it.quantity * scale, 3), unit: it.unit, via: 'meal' as const, fromMealId: meal.id })),
      { onSuccess: onLogged, onError: (e) => setError(errorMessage(e)) },
    );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[17px] font-semibold">{meal.name}</div>
        <div className="text-xs text-muted">Your saved meal · each item is logged separately</div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">How much of it?</span>
        <div role="group" aria-label="Meal portion" className="grid grid-cols-6 gap-1.5 mobile:grid-cols-3">
          {SCALES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scale === s}
              onClick={() => setScale(s)}
              className={`min-h-9 rounded-lg border font-mono text-[13px] mobile:min-h-12 ${scale === s ? 'border-ink bg-ink font-semibold text-white' : 'border-line-strong bg-surface text-ink'}`}
            >
              ×{s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col rounded-[10px] border border-line bg-surface">
        {rows.map(({ it, item, priced }, i) => (
          <div key={i} className={`flex items-center gap-2 border-b border-divider px-3 py-2 last:border-0 ${it.on ? '' : 'opacity-50'}`}>
            <div className="min-w-0 flex-auto">
              <div className="truncate text-[13px] font-medium">{item?.name ?? 'Missing food'}</div>
              <div className="flex items-center gap-1.5">
                <input
                  aria-label={`Amount of ${item?.name ?? 'item'}`}
                  inputMode="decimal"
                  value={String(it.quantity)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0) setItems(items.map((x, j) => (j === i ? { ...x, quantity: n } : x)));
                  }}
                  className={`${inputCls} min-h-8 w-16 font-mono text-[13px]`}
                />
                {item && (
                  <select
                    aria-label="Unit"
                    value={it.unit}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, ...convertPortion(item, x, e.target.value) } : x)))}
                    className={`${inputCls} min-h-8 w-24 text-[13px]`}
                  >
                    {unitsFor(item).map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                )}
                {scale !== 1 && <span className="text-xs text-muted">×{formatQuantity(scale)}</span>}
              </div>
            </div>
            <span className="font-mono text-[13px]">{priced ? fmtKcal(priced.nutrients.kcal) : '—'}</span>
            <button
              type="button"
              aria-label={it.on ? `Leave out ${item?.name ?? 'item'}` : `Include ${item?.name ?? 'item'}`}
              aria-pressed={!it.on}
              onClick={() => setItems(items.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-muted"
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[13px] text-muted" htmlFor={`${id}-time`}>
        Time
        <input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inputCls} w-32`} />
      </label>
      <div className="flex items-center justify-between rounded-[10px] bg-surface-2 px-3 py-2">
        <span className="font-mono text-lg font-semibold">{fmtKcal(total.kcal)} kcal</span>
        <span className="font-mono text-xs text-muted">{macroLine(total)}</span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button variant="primary" size="lg" disabled={!active.length || m.log.isPending} onClick={log}>
        Log {active.length} item{active.length === 1 ? '' : 's'} to {slot}
      </Button>
    </div>
  );
}
