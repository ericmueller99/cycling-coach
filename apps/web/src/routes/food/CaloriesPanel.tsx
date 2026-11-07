import type { FoodLibrary, IsoDate, NutrientKey } from '@cycling-coach/shared';
import { useId, useState } from 'react';
import { Button, ErrorNote, inputCls } from '../../components/ui';
import { CALORIES_ROWS, NUTRIENT_ROWS, fmtKcal, nowTime, parseCalories, type CaloriesDraft } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';

function NumberField({ id, label, unit, value, onChange, autoFocus }: { id: string; label: string; unit: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] text-muted" htmlFor={id}>
      {label}
      <span className="flex items-center gap-1.5">
        <input id={id} type="text" inputMode="decimal" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} min-w-0 font-mono`} />
        <span className="flex-none text-xs">{unit}</span>
      </span>
    </label>
  );
}

const rowOf = (key: NutrientKey) => NUTRIENT_ROWS.find((r) => r.key === key)!;
const MORE_ROWS = NUTRIENT_ROWS.filter((r) => r.key !== 'kcal' && !CALORIES_ROWS.includes(r.key));

/** kcal, then whatever else they know. Shared by logging one and editing one. */
export function CaloriesFields({ draft, onChange, autoFocus }: { draft: CaloriesDraft; onChange: (d: CaloriesDraft) => void; autoFocus?: boolean }) {
  const id = useId();
  const [more, setMore] = useState(() => MORE_ROWS.some((r) => draft[r.key]));
  const field = (key: NutrientKey, focus = false) => {
    const row = rowOf(key);
    return <NumberField key={key} id={`${id}-${key}`} label={row.label} unit={row.unit} value={draft[key] ?? ''} autoFocus={focus} onChange={(v) => onChange({ ...draft, [key]: v })} />;
  };
  return (
    <div className="flex flex-col gap-3">
      {field('kcal', autoFocus)}
      <div className="grid grid-cols-2 gap-2">{CALORIES_ROWS.map((k) => field(k))}</div>
      {more ? (
        <div className="grid grid-cols-2 gap-2">{MORE_ROWS.map((r) => field(r.key))}</div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="min-h-9 self-start border-0 bg-transparent p-0 text-[13px] font-medium text-accent-ink">
          More nutrients
        </button>
      )}
    </div>
  );
}

/** Log a number with no food behind it. Only kcal is needed. */
export function CaloriesPanel({ lib, date, slot, setSlot, onLogged }: { lib: FoodLibrary; date: IsoDate; slot: string; setSlot: (s: string) => void; onLogged: () => void }) {
  const id = useId();
  const m = useFoodMutations();
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<CaloriesDraft>({});
  const [pickedTime, setTime] = useState<string | null>(null);
  const time = pickedTime ?? lib.settings.slots.find((s) => s.name === slot)?.time ?? nowTime();
  const [error, setError] = useState<string | null>(null);
  const nutrients = parseCalories(draft);

  const log = () => {
    if (!nutrients) return;
    m.logCalories.mutate({ date, slot, time, ...(name.trim() ? { name: name.trim() } : {}), nutrients }, { onSuccess: onLogged, onError: (e) => setError(errorMessage(e)) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[17px] font-semibold">Log calories</div>
        <div className="text-xs text-muted">No food needed. Only calories are required.</div>
      </div>
      <label className="flex flex-col gap-1 text-[13px] text-muted" htmlFor={`${id}-name`}>
        What was it? (optional)
        <input id={`${id}-name`} value={name} maxLength={120} placeholder="Calories" onChange={(e) => setName(e.target.value)} className={inputCls} />
      </label>
      <CaloriesFields draft={draft} onChange={setDraft} autoFocus />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[13px] text-muted" htmlFor={`${id}-slot`}>
          Meal
          <select id={`${id}-slot`} value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls}>
            {lib.settings.slots.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted" htmlFor={`${id}-time`}>
          Time
          <input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
        </label>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button variant="primary" disabled={!nutrients || m.logCalories.isPending} onClick={log}>
        Add {nutrients ? `${fmtKcal(nutrients.kcal)} kcal ` : ''}to {slot}
      </Button>
    </div>
  );
}
