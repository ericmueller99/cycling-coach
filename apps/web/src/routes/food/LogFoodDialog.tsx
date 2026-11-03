import { computePortion, formatPortion, rankByUse, startingPortion } from '@cycling-coach/core';
import type { FoodLibrary, IsoDate, Portion, StapleResult } from '@cycling-coach/shared';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { BarcodeIcon, CameraIcon, ChevronLeft, SearchIcon, SparkleIcon } from '../../components/icons';
import { PortionPicker } from '../../components/PortionPicker';
import { Button, ErrorNote, Spinner, inputCls } from '../../components/ui';
import { fmtKcal, itemUsage, libraryItems, nowTime, SOURCE_LINE, type LibraryItem } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { LogFoodAI } from './LogFoodAI';
import { MealLogPanel } from './MealLogPanel';
import { SourceTag } from './SourceTag';
import { STAPLE_SOURCE_LINE, StapleHits, StaplesSwitch, useIncludeStaples, useStapleFood } from './staples';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'recent', label: 'Recent' },
  { key: 'food', label: 'Foods' },
  { key: 'recipe', label: 'Recipes' },
  { key: 'meal', label: 'Meals' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/**
 * Ways to add something that isn't in the foods yet: a label photo and a barcode beside the search,
 * "Enter manually" under the results. Staples are inline (Include staples).
 */
export interface AddNewActions {
  manual: (name: string) => void;
  photo?: (() => void) | undefined;
  barcode?: (() => void) | undefined;
}

function ResultRow({ item, lib, slot, selected, onPick }: { item: LibraryItem; lib: FoodLibrary; slot: string; selected: boolean; onPick: () => void }) {
  const usage = itemUsage(lib, item);
  let line: string;
  let kcal: number;
  if (item.kind === 'meal') {
    line = `${item.meal.items.length} items`;
    kcal = item.meal.total.kcal;
  } else {
    const start = startingPortion(item.loggable, usage, slot);
    line = formatPortion(start.quantity, start.unit);
    kcal = computePortion(item.loggable, start.quantity, start.unit)?.nutrients.kcal ?? 0;
  }
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={`flex min-h-14 w-full items-center gap-3 border-0 border-b border-divider px-3 py-2 text-left text-ink ${selected ? 'bg-accent-tint' : 'bg-surface hover:bg-surface-2'}`}
    >
      <span className="min-w-0 flex-auto">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{item.name}</span>
          <SourceTag source={item.kind === 'food' ? item.food.source : item.kind} />
        </span>
        <span className="block truncate text-xs text-muted">
          {item.kind === 'food' && item.brand ? `${item.brand} · ` : ''}
          {line}
          {usage ? ` · logged ${usage.count}×` : ''}
        </span>
      </span>
      <span className="font-mono text-[13px]">{fmtKcal(kcal)}</span>
    </button>
  );
}

const STAPLES_KEY = 'food.logFood.staples';
const MODE_KEY = 'food.logFood.mode';
export type LogFoodMode = 'search' | 'ai';

function readMode(): LogFoodMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'ai' ? 'ai' : 'search';
  } catch {
    return 'search';
  }
}

/**
 * A staple picked in Log food: its default serving in the portion panel, and one
 * button that saves it to the user's foods and logs it.
 */
function StapleDetailPanel({ hit, lib, date, slot, setSlot, onLogged }: { hit: StapleResult; lib: FoodLibrary; date: IsoDate; slot: string; setSlot: (s: string) => void; onLogged: () => void }) {
  const id = useId();
  const m = useFoodMutations();
  const [name, setName] = useState(hit.name);
  const { detail, input, loggable } = useStapleFood(hit, name);
  const [portion, setPortion] = useState<Portion | null>(null);
  const [pickedTime, setTime] = useState<string | null>(null);
  const time = pickedTime ?? lib.settings.slots.find((s) => s.name === slot)?.time ?? nowTime();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (input && !portion) setPortion(input.defaultPortion);
  }, [input, portion]);
  if (detail.isPending) return <Spinner />;
  if (detail.error || !input || !loggable || !portion) return <ErrorNote>{errorMessage(detail.error)}</ErrorNote>;
  const priced = computePortion(loggable, portion.quantity, portion.unit);
  const busy = m.createFood.isPending || m.log.isPending;

  const saveAndAdd = () =>
    m.createFood.mutate(
      { ...input, name: name.trim() || hit.name },
      {
        onSuccess: (food) =>
          m.log.mutate([{ date, slot, time, kind: 'food', refId: food.id, quantity: portion.quantity, unit: portion.unit, via: 'manual' }], {
            onSuccess: onLogged,
            onError: (e) => setError(errorMessage(e)),
          }),
        onError: (e) => setError(errorMessage(e)),
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-name`} className="text-xs text-muted">
          Save to your foods as
        </label>
        <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} font-semibold`} />
        <div className="text-xs text-muted">{STAPLE_SOURCE_LINE[hit.source]} · not in your foods yet</div>
      </div>
      <PortionPicker item={loggable} value={portion} onChange={setPortion} />
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
      <Button variant="primary" disabled={!priced || busy} onClick={saveAndAdd}>
        Save to my foods &amp; add to {slot}
      </Button>
    </div>
  );
}

/** The food detail: provenance, portion, slot and time, Add. */
function Detail({
  item,
  lib,
  date,
  slot,
  setSlot,
  onLogged,
}: {
  item: Exclude<LibraryItem, { kind: 'meal' }>;
  lib: FoodLibrary;
  date: IsoDate;
  slot: string;
  setSlot: (s: string) => void;
  onLogged: (keepGoing: boolean) => void;
}) {
  const id = useId();
  const m = useFoodMutations();
  const usage = itemUsage(lib, item);
  const start = startingPortion(item.loggable, usage, slot);
  const [portion, setPortion] = useState<Portion>({ quantity: start.quantity, unit: start.unit });
  // The slot's usual time until the user picks one — so switching Breakfast → Lunch moves the time too.
  const [pickedTime, setTime] = useState<string | null>(null);
  const time = pickedTime ?? lib.settings.slots.find((s) => s.name === slot)?.time ?? nowTime();
  const [error, setError] = useState<string | null>(null);
  const priced = computePortion(item.loggable, portion.quantity, portion.unit);

  const add = (keepGoing: boolean) =>
    m.log.mutate([{ date, slot, time, kind: item.kind, refId: item.id, quantity: portion.quantity, unit: portion.unit, via: 'manual' }], {
      onSuccess: () => onLogged(keepGoing),
      onError: (e) => setError(errorMessage(e)),
    });

  const provenance =
    item.kind === 'food'
      ? `${SOURCE_LINE[item.food.source]}${item.food.servingLabel ? ` · per ${item.food.servingLabel}` : ''}`
      : `Your recipe · makes ${item.recipe.servings} servings`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[17px] font-semibold">{item.name}</div>
        <div className="text-xs text-muted">{provenance}</div>
      </div>
      <PortionPicker item={item.loggable} value={portion} onChange={setPortion} hint={start.hint} />
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
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={!priced || m.log.isPending} onClick={() => add(true)}>
          Add &amp; keep going
        </Button>
        <Button variant="primary" disabled={!priced || m.log.isPending} onClick={() => add(false)}>
          Add {priced ? `${fmtKcal(priced.nutrients.kcal)} kcal ` : ''}to {slot}
        </Button>
      </div>
    </div>
  );
}

/**
 * Log food: search the user's own foods, recipes and meals — never a
 * public database — ranked by text, then how often and how recently they log them. Or "Log with
 * AI": describe it, check every matched item, then log. The mode is remembered here.
 */
export function LogFoodDialog({
  lib,
  date,
  slot: initialSlot,
  dateLabel,
  preselect,
  initialQuery,
  includeStaples,
  initialMode,
  initialPhrase,
  addNew,
  onClose,
}: {
  lib: FoodLibrary;
  date: IsoDate;
  slot: string;
  dateLabel: string;
  /** Open straight on this item (e.g. a food just saved with "Save & log"). */
  preselect?: { kind: LibraryItem['kind']; id: string } | undefined;
  initialQuery?: string | undefined;
  /** Open with staples showing (the log bar's "Search staples for 'q'"). */
  includeStaples?: boolean | undefined;
  /** Open in this mode instead of the remembered one (with a phrase for AI). */
  initialMode?: LogFoodMode | undefined;
  initialPhrase?: string | undefined;
  addNew: AddNewActions;
  onClose: () => void;
}) {
  const mobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(initialQuery ?? '');
  // A preselected item or a staples search means search mode, whatever was last used.
  const [mode, setModeState] = useState<LogFoodMode>(() => initialMode ?? (preselect || initialQuery || includeStaples ? 'search' : readMode()));
  const setMode = (next: LogFoodMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private mode */
    }
  };
  const [staple, setStaple] = useState<StapleResult | null>(null);
  const [tab, setTab] = useState<TabKey>('all');
  const [slot, setSlot] = useState(initialSlot);
  const items = useMemo(() => libraryItems(lib), [lib]);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [logged, setLogged] = useState<string | null>(null);

  // A food just saved with "Save & log" shows up once the library has refetched; pick it then.
  const [pending, setPending] = useState(preselect);
  useEffect(() => {
    if (!pending) return;
    const hit = items.find((i) => i.kind === pending.kind && i.id === pending.id);
    if (hit) {
      setSelected(hit);
      setPending(undefined);
    }
  }, [items, pending]);

  useEffect(() => {
    if (!mobile && mode === 'search') searchRef.current?.focus();
  }, [mobile, mode]);

  const results = useMemo(() => {
    const pool = items.filter((i) => tab === 'all' || tab === 'recent' || i.kind === tab);
    const ranked = rankByUse(pool, tab === 'recent' ? '' : q, (i) => itemUsage(lib, i), date);
    if (q.trim() || tab === 'recent') return ranked;
    const seen = new Set(ranked);
    return [...ranked, ...pool.filter((i) => !seen.has(i)).sort((a, b) => a.name.localeCompare(b.name))];
  }, [items, tab, q, lib, date]);

  const activeFoods = lib.foods.filter((f) => !f.archived).length;
  const query = q.trim();
  // Include staples.
  const staples = useIncludeStaples({ storageKey: STAPLES_KEY, activeFoods, query, ownResults: results.length, initialOn: includeStaples });
  const { staplesOn } = staples;
  const pick = (item: LibraryItem) => {
    setStaple(null);
    setSelected(item);
  };
  const pickStaple = (hit: StapleResult) => {
    setSelected(null);
    setStaple(hit);
  };

  const onLogged = (keepGoing: boolean) => {
    if (!keepGoing) return onClose();
    setLogged(selected?.name ?? null);
    setSelected(null);
    setQ('');
    searchRef.current?.focus();
  };

  const slotSelect = (
    <select aria-label="Meal" value={slot} onChange={(e) => setSlot(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-1.5 py-0.5 text-[15px] font-semibold text-ink">
      {lib.settings.slots.map((s) => (
        <option key={s.name}>{s.name}</option>
      ))}
    </select>
  );

  const detail: ReactNode = staple ? (
    <StapleDetailPanel key={`${staple.source}:${staple.ref}`} hit={staple} lib={lib} date={date} slot={slot} setSlot={setSlot} onLogged={onClose} />
  ) : selected ? (
    selected.kind === 'meal' ? (
      <MealLogPanel key={selected.id} meal={selected.meal} lib={lib} date={date} slot={slot} onLogged={onClose} />
    ) : (
      <Detail key={`${selected.kind}:${selected.id}`} item={selected} lib={lib} date={date} slot={slot} setSlot={setSlot} onLogged={onLogged} />
    )
  ) : (
    <div className="flex flex-auto items-center justify-center p-6 text-center text-[13px] text-muted">Pick something to log.</div>
  );

  const addNewRow = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[13px]">
      <span className="text-muted">Not in your foods?</span>
      <button type="button" className="border-0 bg-transparent p-0 font-medium text-accent-ink" onClick={() => addNew.manual(q)}>
        Enter manually
      </button>
    </div>
  );

  const staplesSwitch = <StaplesSwitch on={staplesOn} onToggle={staples.toggle} />;
  const stapleSection = <StapleHits query={query} staples={staples} selected={staple} onPick={pickStaple} className={staplesOn ? 'mt-3' : 'mt-2'} />;

  const modeSwitch = (
    <div role="tablist" aria-label="How to log" className="flex flex-none self-start rounded-[10px] bg-track p-0.5">
      {(
        [
          ['search', 'Search my foods', <SearchIcon key="s" size={14} />],
          ['ai', 'Log with AI', <SparkleIcon key="a" size={14} />],
        ] as const
      ).map(([key, label, icon]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          onClick={() => setMode(key)}
          className={`flex min-h-8 items-center gap-1.5 rounded-lg border-0 px-3 text-[13px] text-ink mobile:min-h-10 ${mode === key ? 'bg-surface font-semibold shadow-[0_1px_2px_rgba(16,24,40,.12)]' : 'bg-transparent font-medium'}`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );

  const searchBlock = (
    <div className="flex flex-col gap-2.5">
      {modeSwitch}
      <div className="flex items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3">
        <SearchIcon size={16} className="text-muted" />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search your foods"
          placeholder="Search your foods, recipes and meals"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (tab === 'recent') setTab('all');
          }}
          className="min-h-10 min-w-0 flex-auto border-0 bg-transparent text-ink outline-none mobile:min-h-[44px]"
        />
        {addNew.photo && (
          <button
            type="button"
            aria-label="Add from a label photo"
            title="Add from a label photo"
            onClick={addNew.photo}
            className={`${addNew.barcode ? '' : '-mr-2 '}flex h-10 w-10 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-ink hover:bg-surface-2 mobile:h-11 mobile:w-11`}
          >
            <CameraIcon />
          </button>
        )}
        {addNew.barcode && (
          <button type="button" aria-label="Scan barcode" title="Scan barcode" onClick={addNew.barcode} className="-mr-2 flex h-10 w-10 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-ink hover:bg-surface-2 mobile:h-11 mobile:w-11">
            <BarcodeIcon />
          </button>
        )}
      </div>
      {mobile && staplesSwitch}
      <div className="flex items-center gap-2">
      <div role="tablist" aria-label="Kind" className="scrollbar-none flex min-w-0 flex-auto gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-8 flex-none rounded-full border px-3 text-[13px] mobile:min-h-9 ${tab === t.key ? 'border-ink bg-ink font-semibold text-white' : 'border-line-strong bg-surface text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!mobile && staplesSwitch}
      </div>
      {logged && <div className="rounded-lg bg-[#ECFDF3] px-3 py-1.5 text-[13px] text-[#085D3A]">Logged {logged}. Keep going.</div>}
    </div>
  );

  const resultList = (
    <div role="listbox" aria-label="Results" className="flex flex-none flex-col overflow-hidden rounded-[10px] border border-line">
      {results.length ? (
        results.map((item) => (
          <ResultRow key={`${item.kind}:${item.id}`} item={item} lib={lib} slot={slot} selected={selected?.kind === item.kind && selected.id === item.id} onPick={() => pick(item)} />
        ))
      ) : (
        <div className="p-4 text-[13px] text-muted">
          {items.length ? `Nothing in your foods matches “${q}”.` : staplesOn ? 'Your foods are empty — search for a staple and it is saved as you log it.' : 'Your foods are empty — add your first one below. After that, logging is a search.'}
        </div>
      )}
    </div>
  );

  const title = (
    <span className="flex flex-wrap items-center gap-2">
      Log food to {slotSelect}
      <span className="text-[13px] font-normal text-muted">· {dateLabel}</span>
    </span>
  );

  if (mode === 'ai') {
    return (
      <Dialog title={title} onClose={onClose} width={960} tall>
        <LogFoodAI
          lib={lib}
          date={date}
          slot={slot}
          mobile={mobile}
          modeSwitch={modeSwitch}
          staplesOn={staplesOn}
          onToggleStaples={staples.toggle}
          initialPhrase={initialPhrase}
          addNew={addNew}
          onSearchMode={() => setMode('search')}
          onClose={onClose}
        />
      </Dialog>
    );
  }

  if (mobile) {
    return (
      <Dialog title={title} onClose={onClose} tall>
        {selected || staple ? (
          <>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setStaple(null);
              }} className="flex min-h-[44px] items-center gap-1 self-start border-0 bg-transparent p-0 font-medium text-accent-ink">
              <ChevronLeft /> Results
            </button>
            {detail}
          </>
        ) : (
          <>
            {searchBlock}
            {resultList}
            {stapleSection}
            {addNewRow}
          </>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog title={title} onClose={onClose} width={960} tall>
      <div className="grid min-h-0 flex-auto grid-cols-[minmax(0,1fr)_380px] grid-rows-[minmax(0,1fr)] gap-5">
        <div className="flex min-h-0 flex-col gap-3">
          {searchBlock}
          <div className="flex min-h-0 flex-auto flex-col overflow-y-auto">
            {resultList}
            {stapleSection}
          </div>
          {addNewRow}
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto rounded-[12px] border border-line bg-surface-alt p-4">{detail}</div>
      </div>
    </Dialog>
  );
}
