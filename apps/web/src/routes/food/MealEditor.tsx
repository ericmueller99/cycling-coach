import { foodAsLoggable, mealTotal } from '@cycling-coach/core';
import type { Food, FoodLibrary, Meal, MealInput, MealItem } from '@cycling-coach/shared';
import { useId, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { TrashIcon } from '../../components/icons';
import { Button, ErrorNote, Field, inputCls } from '../../components/ui';
import { findLoggable, fmtKcal, macroLine } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { ItemSearch } from './ItemSearch';
import { PortionRow } from './PortionRow';

/**
 * Meal builder: a saved combo like "Usual breakfast" of foods and recipes at set
 * portions. Logging it writes each item separately, so one can be tweaked on the day.
 */
export function MealEditor({
  lib,
  today,
  meal,
  initialItems,
  initialSlot,
  onClose,
  onSaved,
}: {
  lib: FoodLibrary;
  today: string;
  meal?: Meal | undefined;
  /** "Save as meal" from a day's slot. */
  initialItems?: MealItem[] | undefined;
  initialSlot?: string | undefined;
  onClose: () => void;
  onSaved: (m: Meal, log: boolean) => void;
}) {
  const id = useId();
  const m = useFoodMutations();
  const [name, setName] = useState(meal?.name ?? '');
  const [slot, setSlot] = useState(meal?.slot ?? initialSlot ?? '');
  const [items, setItems] = useState<MealItem[]>(meal?.items ?? initialItems ?? []);
  const [aliases, setAliases] = useState(meal?.aliases.join(', ') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Staples saved from the search while the library refetches.
  const [extraFoods, setExtraFoods] = useState<Food[]>([]);
  const lookup = (kind: MealItem['kind'], refId: string) => {
    const hit = findLoggable(lib, kind, refId);
    if (hit || kind !== 'food') return hit;
    const extra = extraFoods.find((f) => f.id === refId);
    return extra ? foodAsLoggable(extra) : undefined;
  };
  const total = mealTotal(items, lookup);
  const busy = m.createMeal.isPending || m.updateMeal.isPending;

  const save = (log: boolean) => {
    if (!name.trim()) return setError('Give the meal a name, e.g. "Usual breakfast".');
    if (!items.length) return setError('Add at least one item.');
    setError(null);
    const body: MealInput = { name: name.trim(), items, aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean), ...(slot ? { slot } : {}) };
    const fail = (e: unknown) => setError(errorMessage(e));
    if (meal) m.updateMeal.mutate({ id: meal.id, patch: { ...body, ...(!slot && meal.slot ? { unset: ['slot' as const] } : {}) } }, { onSuccess: (x) => onSaved(x, log), onError: fail });
    else m.createMeal.mutate(body, { onSuccess: (x) => onSaved(x, log), onError: fail });
  };

  return (
    <Dialog
      title={meal ? 'Edit meal' : 'New meal'}
      width={720}
      tall
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[15px] font-semibold">{fmtKcal(total.kcal)} kcal</span>
            <span className="font-mono text-xs text-muted">{macroLine(total)}</span>
            <span className="grow" />
            {meal &&
              (confirmDelete ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => m.archiveMeal.mutate(meal.id, { onSuccess: onClose, onError: (e) => setError(errorMessage(e)) })}>
                    Remove meal
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" aria-label="Remove meal" onClick={() => setConfirmDelete(true)}>
                  <TrashIcon />
                </Button>
              ))}
            <Button disabled={busy} onClick={() => save(false)}>
              Save meal
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => save(true)}>
              Save &amp; log now
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3 mobile:grid-cols-1">
        <Field label="Meal name" htmlFor={`${id}-name`}>
          <input id={`${id}-name`} value={name} placeholder="Usual breakfast" onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Usually eaten at" htmlFor={`${id}-slot`}>
          <select id={`${id}-slot`} value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls}>
            <option value="">Any meal</option>
            {lib.settings.slots.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <section aria-label="Items" className="flex flex-col">
        <div className="text-[13px] font-semibold">Items</div>
        {items.map((it, i) => (
          <PortionRow
            key={`${it.kind}:${it.refId}:${i}`}
            item={lookup(it.kind, it.refId)}
            name="Missing item"
            portion={{ quantity: it.quantity, unit: it.unit }}
            onChange={(p) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)))}
            onRemove={() => setItems(items.filter((_, j) => j !== i))}
          />
        ))}
        {!items.length && <div className="py-2 text-[13px] text-muted">No items yet.</div>}
      </section>
      <ItemSearch
        lib={lib}
        today={today}
        kinds={['food', 'recipe']}
        placeholder="Add a food or recipe…"
        onPick={(item, p) => setItems([...items, { kind: item.kind, refId: item.id, quantity: p.quantity, unit: p.unit }])}
        addNew={{
          target: 'meal',
          onSaved: (food, p, add) => {
            setExtraFoods([...extraFoods, food]);
            if (add) setItems([...items, { kind: 'food', refId: food.id, quantity: p.quantity, unit: p.unit }]);
          },
        }}
      />
      <Field label={<>Also find it as <span className="font-normal">· helps “log with words”</span></>} htmlFor={`${id}-al`}>
        <input id={`${id}-al`} value={aliases} placeholder="usual breakfast, the usual" onChange={(e) => setAliases(e.target.value)} className={inputCls} />
      </Field>
    </Dialog>
  );
}
