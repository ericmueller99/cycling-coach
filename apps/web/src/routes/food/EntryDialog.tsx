import { addDays } from '@cycling-coach/core';
import type { FoodLibrary, FoodLogEntry, IsoDate, Portion } from '@cycling-coach/shared';
import { useId, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { PortionPicker } from '../../components/PortionPicker';
import { Button, ErrorNote, inputCls } from '../../components/ui';
import { findLoggable, fmtKcal, macroLine } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { SourceTag } from './SourceTag';

/** A logged row's ⋯: edit portion, move to another meal, copy to another day, delete. */
export function EntryDialog({ entry, lib, onClose }: { entry: FoodLogEntry; lib: FoodLibrary; onClose: () => void }) {
  const id = useId();
  const m = useFoodMutations();
  const item = findLoggable(lib, entry.kind, entry.refId);
  const [portion, setPortion] = useState<Portion>({ quantity: entry.quantity, unit: entry.unit });
  const [slot, setSlot] = useState(entry.slot);
  const [time, setTime] = useState(entry.time ?? '');
  const [copyTo, setCopyTo] = useState<IsoDate>(addDays(entry.date, 1));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fail = (e: unknown) => setError(errorMessage(e));
  const slots = [...new Set([...lib.settings.slots.map((s) => s.name), entry.slot])];

  const save = () =>
    m.patchEntry.mutate(
      {
        id: entry.id,
        patch: {
          ...(portion.quantity !== entry.quantity || portion.unit !== entry.unit ? portion : {}),
          ...(slot !== entry.slot ? { slot } : {}),
          ...(time ? (time !== entry.time ? { time } : {}) : entry.time ? { unset: ['time' as const] } : {}),
        },
      },
      { onSuccess: onClose, onError: fail },
    );

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
              Delete
            </Button>
            <span className="grow" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={m.patchEntry.isPending} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      {item ? (
        <PortionPicker item={item} value={portion} onChange={setPortion} />
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
