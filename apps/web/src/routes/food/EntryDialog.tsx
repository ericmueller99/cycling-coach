import { addDays, entryRef, estimateItemTotals, estimateTotals } from '@cycling-coach/core';
import type { EstimateItem, FoodLibrary, FoodLogEntry, IsoDate, Portion } from '@cycling-coach/shared';
import { useId, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { PortionPicker } from '../../components/PortionPicker';
import { Button, ErrorNote, inputCls } from '../../components/ui';
import { caloriesDraft, entryLine, findLoggable, fmtKcal, macroLine, parseCalories, type CaloriesDraft } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { CaloriesFields } from './CaloriesPanel';
import { EntryPhotoList } from './EntryPhotos';
import { EstimateItems, itemTitle } from './EstimateReview';
import { SourceTag } from './SourceTag';

/** What's in a logged estimate, with Change portions and View photos. */
function EstimateDetail({ entry, items, onChange }: { entry: FoodLogEntry; items: EstimateItem[]; onChange: (items: EstimateItem[]) => void }) {
  const mobile = useIsMobile();
  const [changing, setChanging] = useState(false);
  const [photos, setPhotos] = useState(false);
  const { low, high, nutrients } = estimateTotals(items);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[10px] bg-surface-2 p-3">
        <div className="font-mono text-lg font-semibold">≈ {fmtKcal(nutrients.kcal)} kcal</div>
        <div className="font-mono text-xs text-muted">
          likely {fmtKcal(low)}–{fmtKcal(high)} · {macroLine(nutrients)}
        </div>
      </div>
      {changing ? (
        <EstimateItems items={items} mobile={mobile} onChange={onChange} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="min-w-0">{itemTitle(item)}</span>
              <span className="flex-none font-mono">{fmtKcal(estimateItemTotals(item).nutrients.kcal)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {!changing && (
          <Button size="sm" onClick={() => setChanging(true)}>
            Change portions
          </Button>
        )}
        {entry.estimate!.images.length > 0 && (
          <Button size="sm" onClick={() => setPhotos(!photos)}>
            {photos ? 'Hide photos' : 'View photos'}
          </Button>
        )}
      </div>
      {photos && <EntryPhotoList entry={entry} />}
      {entry.estimate!.savedAs && <div className="text-xs text-muted">Saved to your foods as “{entry.estimate!.savedAs}”.</div>}
    </div>
  );
}

/** A logged row's ⋯: edit portion or numbers, move to another meal, copy to another day, delete. */
export function EntryDialog({ entry, lib, onClose }: { entry: FoodLogEntry; lib: FoodLibrary; onClose: () => void }) {
  const id = useId();
  const m = useFoodMutations();
  const ref = entryRef(entry);
  const item = ref ? findLoggable(lib, ref.kind, ref.refId) : undefined;
  const [portion, setPortion] = useState<Portion>({ quantity: entry.quantity, unit: entry.unit });
  const [slot, setSlot] = useState(entry.slot);
  const [time, setTime] = useState(entry.time ?? '');
  const [copyTo, setCopyTo] = useState<IsoDate>(addDays(entry.date, 1));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [name, setName] = useState(entry.name);
  const [draft, setDraft] = useState<CaloriesDraft>(() => caloriesDraft(entry.nutrients));
  const [items, setItems] = useState(entry.estimate?.items ?? []);
  const fail = (e: unknown) => setError(errorMessage(e));
  const slots = [...new Set([...lib.settings.slots.map((s) => s.name), entry.slot])];

  const hasItems = items.length > 0;
  const typed = !ref && !entry.estimate;
  const nutrients = typed ? parseCalories(draft) : null;

  const patch = () =>
    m.patchEntry.mutate(
      {
        id: entry.id,
        patch: {
          ...(ref && (portion.quantity !== entry.quantity || portion.unit !== entry.unit) ? portion : {}),
          ...(slot !== entry.slot ? { slot } : {}),
          ...(time ? (time !== entry.time ? { time } : {}) : entry.time ? { unset: ['time' as const] } : {}),
        },
      },
      { onSuccess: onClose, onError: fail },
    );

  /** Numbers and items go through their own route, so an estimate's total stays the sum of its items. */
  const save = () => {
    const trimmed = name.trim();
    const edit = {
      ...(trimmed && trimmed !== entry.name ? { name: trimmed } : {}),
      ...(typed && nutrients ? { nutrients } : {}),
      ...(hasItems ? { items } : {}),
    };
    if (ref || !Object.keys(edit).length) return patch();
    m.editCalories.mutate({ id: entry.id, edit }, { onSuccess: patch, onError: fail });
  };

  return (
    <Dialog
      title={
        <span className="flex items-center gap-2">
          {entry.name} <SourceTag source={entry.source} />
        </span>
      }
      width={520}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" size="sm" disabled={m.deleteEntry.isPending} onClick={() => m.deleteEntry.mutate(entry.id, { onSuccess: onClose, onError: fail })}>
              {entry.estimate ? 'Remove' : 'Delete'}
            </Button>
            <span className="grow" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={m.patchEntry.isPending || m.editCalories.isPending || (typed && !nutrients)} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      {!ref && (
        <label className="flex flex-col gap-1 text-[13px] text-muted" htmlFor={`${id}-name`}>
          Name
          <input id={`${id}-name`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
      )}
      {typed ? (
        <CaloriesFields draft={draft} onChange={setDraft} />
      ) : hasItems ? (
        <EstimateDetail entry={entry} items={items} onChange={setItems} />
      ) : item ? (
        <>
          {entry.estimate && <div className="text-xs text-muted">{entryLine(entry)}</div>}
          <PortionPicker item={item} value={portion} onChange={setPortion} />
        </>
      ) : (
        <div className="rounded-[10px] bg-surface-2 p-3 text-[13px] text-muted">
          {entry.quantity} {entry.unit} · {fmtKcal(entry.nutrients.kcal)} kcal · {macroLine(entry.nutrients)}
          <div className="mt-1">This food is no longer in your foods; its portion can only be changed in the same unit.</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[13px] text-muted" htmlFor={`${id}-slot`}>
          Meal
          <select id={`${id}-slot`} value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls}>
            {slots.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted" htmlFor={`${id}-time`}>
          Time
          <input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-divider pt-3">
        <label className="flex flex-col gap-1 text-[13px] text-muted" htmlFor={`${id}-copy`}>
          Copy to another day
          <input id={`${id}-copy`} type="date" value={copyTo} onChange={(e) => setCopyTo(e.target.value)} className={inputCls} />
        </label>
        <Button
          disabled={!copyTo || m.copyEntry.isPending}
          onClick={() => m.copyEntry.mutate({ id: entry.id, date: copyTo, slot }, { onSuccess: () => setCopied(copyTo), onError: fail })}
        >
          Copy
        </Button>
        {copied && <span className="pb-2 text-[13px] text-success">Copied to {copied}.</span>}
      </div>
    </Dialog>
  );
}
