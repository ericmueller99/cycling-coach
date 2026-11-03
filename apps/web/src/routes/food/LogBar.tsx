import { computePortion, formatPortion, rankByUse, roundTo, slotForTime, startingPortion } from '@cycling-coach/core';
import type { FoodLibrary, FoodLogEntry, FoodLogInput, IsoDate } from '@cycling-coach/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon, SparkleIcon } from '../../components/icons';
import { fmtKcal, itemUsage, libraryItems, nowTime, type LibraryItem } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { SourceTag } from './SourceTag';

type Mode = 'foods' | 'ai';
const MODE_KEY = 'food.logBar.mode';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'ai' ? 'ai' : 'foods';
  } catch {
    return 'foods';
  }
}

/** The entries for "Add" at the usual portion — a meal adds each of its items. */
function quickEntries(lib: FoodLibrary, item: LibraryItem, date: IsoDate, slot: string): FoodLogInput[] {
  const time = lib.settings.slots.find((s) => s.name === slot)?.time ?? nowTime();
  if (item.kind === 'meal') {
    return item.meal.items.map((it) => ({ date, slot, time, kind: it.kind, refId: it.refId, quantity: it.quantity, unit: it.unit, via: 'meal' as const, fromMealId: item.id }));
  }
  const start = startingPortion(item.loggable, itemUsage(lib, item), slot);
  return [{ date, slot, time, kind: item.kind, refId: item.id, quantity: roundTo(start.quantity, 3), unit: start.unit, via: 'manual' }];
}

function usualLine(lib: FoodLibrary, item: LibraryItem, slot: string): { portion: string; kcal: number } {
  if (item.kind === 'meal') return { portion: `${item.meal.items.length} items`, kcal: item.meal.total.kcal };
  const start = startingPortion(item.loggable, itemUsage(lib, item), slot);
  return { portion: formatPortion(start.quantity, start.unit), kcal: computePortion(item.loggable, start.quantity, start.unit)?.nutrients.kcal ?? 0 };
}

/**
 * The log bar: **My foods** searches the user's own foods with no AI and adds at the
 * usual portion in one tap; **AI** sends a sentence to the small model and opens the confirmation.
 * The mode is remembered on this device.
 */
export function LogBar({
  lib,
  date,
  today,
  mobile,
  onAI,
  onPortion,
  onStaples,
}: {
  lib: FoodLibrary;
  date: IsoDate;
  today: IsoDate;
  mobile: boolean;
  onAI: (phrase: string, slot: string) => void;
  onPortion: (item: LibraryItem, slot: string) => void;
  onStaples: (query: string, slot: string) => void;
}) {
  const m = useFoodMutations();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [toast, setToast] = useState<{ message: string; entries: FoodLogEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const slot = slotForTime(lib.settings.slots, date === today ? nowTime() : '12:00');

  const setMode = (next: Mode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private mode */
    }
    inputRef.current?.focus();
  };

  const items = useMemo(() => libraryItems(lib), [lib]);
  const results = useMemo(() => (mode === 'foods' && text.trim() ? rankByUse(items, text, (i) => itemUsage(lib, i), date).slice(0, 6) : []), [items, text, lib, date, mode]);
  useEffect(() => setActive(0), [text, mode]);

  // Close the dropdown on a click outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const add = (item: LibraryItem) => {
    setError(null);
    m.log.mutate(quickEntries(lib, item, date, slot), {
      onSuccess: (r) => {
        setToast({ message: `Added ${item.name} to ${slot}`, entries: r.entries });
        setText('');
        setOpen(false);
      },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  const undo = () => {
    if (!toast) return;
    for (const e of toast.entries) m.deleteEntry.mutate(e.id);
    setToast(null);
  };

  const submit = () => {
    const q = text.trim();
    if (mode === 'ai') {
      if (q.length >= 2) {
        onAI(q, slot);
        setText('');
      }
      return;
    }
    const pick = results[active];
    if (pick) add(pick);
  };

  const ai = mode === 'ai';
  const switchBtn = (key: Mode, label: string, short: string, Icon: typeof SearchIcon) => {
    const on = mode === key;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setMode(key)}
        className={`flex items-center gap-1.5 rounded-[8px] border-0 px-2.5 text-[13px] font-semibold ${mobile ? 'min-h-9' : 'min-h-8'} ${
          on ? (key === 'ai' ? 'bg-ink text-accent' : 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]') : 'bg-transparent text-muted'
        }`}
      >
        <Icon size={14} />
        {mobile ? short : label}
      </button>
    );
  };

  return (
    <div ref={boxRef} className="flex flex-col gap-1">
      <div className="relative">
      <form
        className={`flex items-center gap-2 border bg-surface py-1.5 pr-1.5 pl-1.5 ${mobile ? 'rounded-3xl' : 'rounded-[14px]'} ${ai ? 'border-accent-ring' : 'border-[#CDD2DA]'}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div role="radiogroup" aria-label="Log with" className={`flex flex-none gap-0.5 bg-hover p-[3px] ${mobile ? 'rounded-[20px]' : 'rounded-[10px]'}`}>
          {switchBtn('foods', 'My foods', 'Foods', SearchIcon)}
          {switchBtn('ai', 'AI', 'AI', SparkleIcon)}
        </div>
        <input
          ref={inputRef}
          aria-label={ai ? 'Describe what you ate' : 'Search your foods'}
          aria-expanded={!ai && open && !!text.trim()}
          aria-controls="logbar-results"
          placeholder={ai ? (mobile ? 'Describe it…' : 'Describe it — "blueberry bagel and butter for breakfast"') : mobile ? 'Search your foods' : 'Search your foods — e.g. bagel'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (ai || !results.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Escape') setOpen(false);
          }}
          className="min-h-10 min-w-0 flex-auto border-0 bg-transparent text-ink outline-none"
        />
        <button
          type="submit"
          disabled={ai ? text.trim().length < 2 : !results.length}
          className={`flex min-h-10 flex-none items-center rounded-[10px] border-0 px-4 font-semibold ${mobile ? 'rounded-[20px]' : ''} ${ai ? 'bg-ink text-white' : 'bg-hover text-ink'}`}
        >
          {ai ? (mobile ? 'Log' : 'Log with AI') : mobile ? 'Add' : 'Search'}
        </button>
      </form>
      {!ai && open && text.trim() && (
        <div id="logbar-results" className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-[12px] border border-line bg-surface shadow-[0_12px_30px_rgba(0,0,0,.12)]">
          <div className="border-b border-divider bg-surface-2 px-3 py-1.5 text-xs text-muted">
            Your foods · adds to <strong className="text-ink">{slot}</strong> at your usual portion
          </div>
          {results.length ? (
            <div role="listbox" aria-label="Your foods">
              {results.map((item, i) => {
                const u = usualLine(lib, item, slot);
                return (
                  <div
                    key={`${item.kind}:${item.id}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    className={`flex min-h-12 items-center gap-2 border-b border-divider px-3 py-1.5 last:border-b-0 ${i === active ? 'bg-accent-tint' : ''}`}
                  >
                    <span className="min-w-0 flex-auto">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{item.name}</span>
                        <SourceTag source={item.kind === 'food' ? item.food.source : item.kind} />
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {u.portion} · {fmtKcal(u.kcal)} kcal
                      </span>
                    </span>
                    <button type="button" onClick={() => onPortion(item, slot)} className="min-h-9 flex-none rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink">
                      Portion…
                    </button>
                    <button type="button" disabled={m.log.isPending} onClick={() => add(item)} className="min-h-9 flex-none rounded-lg border-0 bg-accent px-3 text-[13px] font-semibold text-on-accent">
                      Add
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-3 text-[13px] text-muted">No match in your foods.</div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-divider px-3 py-2 text-[13px]">
            <button type="button" onClick={() => onStaples(text.trim(), slot)} className="border-0 bg-transparent p-0 font-medium text-accent-ink">
              Search staples for “{text.trim()}”
            </button>
            <button type="button" onClick={() => setMode('ai')} className="border-0 bg-transparent p-0 font-medium text-accent-ink">
              Try AI instead
            </button>
          </div>
        </div>
      )}

      </div>
      {ai ? (
        <div className="pl-1 text-xs text-accent-ink">AI mode · a small model reads your sentence, then matches your foods. You confirm before anything is logged.</div>
      ) : (
        !mobile && <div className="pl-1 text-xs text-muted">Searches your foods only — no AI. Pick a match to add it at your usual portion.</div>
      )}

      {error && <div className="pl-1 text-xs text-danger">{error}</div>}
      {toast && (
        <div role="status" className="fixed bottom-[calc(140px+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[12px] bg-ink px-4 py-2.5 text-[13px] text-white shadow-lg desktop:bottom-8">
          {toast.message}
          <button type="button" onClick={undo} className="border-0 bg-transparent p-0 font-semibold text-accent">
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
