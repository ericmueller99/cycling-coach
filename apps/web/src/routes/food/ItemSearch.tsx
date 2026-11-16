import { computePortion, rankByUse, startingPortion } from '@cycling-coach/core';
import type { Food, FoodLibrary, Portion, StapleResult } from '@cycling-coach/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { CameraIcon, SearchIcon } from '../../components/icons';
import { PortionPicker } from '../../components/PortionPicker';
import { Button, ErrorNote, Spinner, inputCls } from '../../components/ui';
import { fmtKcal, itemUsage, libraryItems, type LibraryItem } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { LabelAddDialog } from './LabelAddPanel';
import { SourceTag } from './SourceTag';
import { STAPLE_SOURCE_LINE, StapleHits, StaplesSwitch, useIncludeStaples, useStapleFood } from './staples';

type Pickable = Exclude<LibraryItem, { kind: 'meal' }>;

/** Staples in the recipe and meal builders share one remembered on/off choice. */
const BUILDER_STAPLES_KEY = 'food.builder.staples';

/** Adding something that isn't in the user's foods yet, without leaving the builder: a staple or a label photo. */
export interface ItemSearchAddNew {
  /** What "add" adds to — the button reads "Save to my foods & add to {target}". */
  target: 'recipe' | 'meal';
  /** A new food was saved to the user's foods; `add` when they also want it in the recipe / meal. */
  onSaved: (food: Food, portion: Portion, add: boolean) => void;
}

/**
 * A staple picked in a builder, over it (DECISIONS #109): name, portion, and two explicit saves. Both
 * create the food (an ingredient or meal item always points at one of the user's foods); only one also adds it.
 */
function StapleAddDialog({ hit, target, onSaved, onClose }: { hit: StapleResult; target: ItemSearchAddNew['target']; onSaved: (food: Food, portion: Portion, add: boolean) => void; onClose: () => void }) {
  const id = useId();
  const m = useFoodMutations();
  const [name, setName] = useState(hit.name);
  const { detail, input, loggable } = useStapleFood(hit, name);
  const [portion, setPortion] = useState<Portion | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (input && !portion) setPortion(input.defaultPortion);
  }, [input, portion]);

  const ready = !detail.isPending && !detail.error && input && loggable && portion ? { input, loggable, portion } : null;
  const priced = ready && computePortion(ready.loggable, ready.portion.quantity, ready.portion.unit);
  const busy = m.createFood.isPending;
  const save = (add: boolean) =>
    ready && m.createFood.mutate({ ...ready.input, name: name.trim() || hit.name }, { onSuccess: (food) => onSaved(food, ready.portion, add), onError: (e) => setError(errorMessage(e)) });

  return (
    <Dialog
      title="Add a staple"
      width={560}
      panel
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <span className="grow" />
            <Button disabled={busy || !ready || !name.trim()} onClick={() => save(false)}>
              Save to my foods only
            </Button>
            <Button variant="primary" disabled={busy || !priced || !name.trim()} onClick={() => save(true)}>
              Save to my foods &amp; add {priced ? `${fmtKcal(priced.nutrients.kcal)} kcal ` : ''}to {target}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-name`} className="text-xs text-muted">
          Save to your foods as
        </label>
        <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} font-semibold`} />
        <div className="text-xs text-muted">{STAPLE_SOURCE_LINE[hit.source]} · not in your foods yet</div>
      </div>
      {detail.isPending ? <Spinner /> : ready ? <PortionPicker item={ready.loggable} value={ready.portion} onChange={setPortion} /> : <ErrorNote>{errorMessage(detail.error)}</ErrorNote>}
    </Dialog>
  );
}

/**
 * Search the user's foods (and recipes) to add as an ingredient or meal item. Picks start at the usual
 * portion, like logging does. With `addNew`, an "Include staples" switch adds CNF / USDA matches
 * and "Label photo" reads a nutrition label — each in a dialog over the builder, saved to their foods (and added).
 */
export function ItemSearch({
  lib,
  today,
  kinds,
  onPick,
  placeholder,
  footer,
  addNew,
  seed,
  exclude,
}: {
  lib: FoodLibrary;
  today: string;
  kinds: ('food' | 'recipe')[];
  /** Ids that can't be picked here: a recipe can't use itself, or a recipe that uses it (DECISIONS #113). */
  exclude?: ReadonlySet<string> | undefined;
  onPick: (item: Pickable, portion: Portion) => void;
  placeholder: string;
  footer?: React.ReactNode;
  addNew?: ItemSearchAddNew | undefined;
  /** Put a search in from outside (a "Search" button elsewhere); `at` changes each time it's pressed. */
  seed?: { q: string; at: number } | undefined;
}) {
  const mobile = useIsMobile();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // One at a time, each a dialog over the builder: a picked staple or a label being read.
  const [card, setCard] = useState<{ kind: 'staple'; hit: StapleResult } | { kind: 'label' } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!seed) return;
    setQ(seed.q);
    setCard(null);
    setSaved(null);
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ block: 'nearest' });
  }, [seed?.at]);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const pool = libraryItems(lib).filter((i): i is Pickable => i.kind !== 'meal' && kinds.includes(i.kind) && !exclude?.has(i.id));
    return rankByUse(pool, q, (i) => itemUsage(lib, i), today).slice(0, 8);
  }, [lib, q, kinds, today, exclude]);

  const query = q.trim();
  const staples = useIncludeStaples({
    storageKey: BUILDER_STAPLES_KEY,
    activeFoods: lib.foods.filter((f) => !f.archived).length,
    // Without the staples option the hook never searches: an empty query is below its minimum.
    query: addNew ? query : '',
    ownResults: results.length,
  });
  const staplesOn = !!addNew && staples.staplesOn;
  const openLabel = () => {
    setCard({ kind: 'label' });
    setSaved(null);
  };
  const extras = addNew && (
    <div className={`flex flex-none items-center gap-3 ${mobile ? '' : 'self-center'}`}>
      <StaplesSwitch on={staplesOn} onToggle={staples.toggle} />
      <button
        type="button"
        onClick={openLabel}
        className="flex min-h-8 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink hover:bg-surface-2 mobile:min-h-9"
      >
        <CameraIcon size={15} /> Label photo
      </button>
    </div>
  );
  const onNewSaved = (food: Food, portion: Portion, add: boolean) => {
    addNew?.onSaved(food, portion, add);
    setCard(null);
    setQ('');
    setSaved(add ? null : food.name);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-auto items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3">
          <SearchIcon size={16} className="text-muted" />
          <input
            ref={inputRef}
            type="search"
            aria-label={placeholder}
            placeholder={placeholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSaved(null);
            }}
            className="min-h-10 min-w-0 flex-auto border-0 bg-transparent text-ink outline-none mobile:min-h-[44px]"
          />
        </div>
        {!mobile && extras}
      </div>
      {mobile && extras}
      {results.length > 0 && (
        <div role="listbox" aria-label="Matches" className="flex flex-col overflow-hidden rounded-[10px] border border-line">
          {results.map((item) => {
            const start = startingPortion(item.loggable, itemUsage(lib, item));
            const kcal = computePortion(item.loggable, start.quantity, start.unit)?.nutrients.kcal ?? 0;
            return (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(item, { quantity: start.quantity, unit: start.unit });
                  setQ('');
                }}
                className="flex min-h-11 items-center gap-2 border-0 border-b border-divider bg-surface px-3 text-left text-ink last:border-b-0 hover:bg-surface-2"
              >
                <span className="min-w-0 flex-auto truncate font-medium">{item.name}</span>
                <SourceTag source={item.kind === 'food' ? item.food.source : 'recipe'} />
                <span className="w-12 text-right font-mono text-[13px]">{fmtKcal(kcal)}</span>
              </button>
            );
          })}
        </div>
      )}
      {query && !results.length && card?.kind !== 'label' && (
        <div className="px-1 text-[13px] text-muted">
          Nothing in your foods matches “{q}”.
          {addNew && (
            <>
              {' '}
              <button type="button" onClick={openLabel} className="border-0 bg-transparent p-0 font-medium text-accent-ink">
                Read a label photo
              </button>
            </>
          )}
        </div>
      )}
      {addNew && <StapleHits query={query} staples={staples} selected={null} onPick={(hit) => setCard({ kind: 'staple', hit })} className="" />}
      {addNew &&
        // Opened over the builder, so its own Save & log can't be tapped mid-way (DECISIONS #109).
        (card?.kind === 'label' ? (
          <LabelAddDialog target={addNew.target} nameHint={query} onClose={() => setCard(null)} onSaved={onNewSaved} />
        ) : card?.kind === 'staple' ? (
          <StapleAddDialog key={`${card.hit.source}:${card.hit.ref}`} hit={card.hit} target={addNew.target} onClose={() => setCard(null)} onSaved={onNewSaved} />
        ) : null)}
      {saved && <div className="rounded-lg bg-[#ECFDF3] px-3 py-1.5 text-[13px] text-[#085D3A]">Saved {saved} to your foods.</div>}
      {footer}
    </div>
  );
}
