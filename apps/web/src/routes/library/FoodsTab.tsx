import { computePortion, formatPortion, formatShortDate, rankByUse } from '@cycling-coach/core';
import type { Food, FoodLibrary, FoodSource } from '@cycling-coach/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { BarcodeIcon, ChevronRight, TrashIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { Button, ErrorNote } from '../../components/ui';
import { fmtG, fmtKcal, itemUsage, SOURCE_LINE } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { FoodPhotos } from '../food/FoodForm';
import type { useFoodFlows } from '../food/flows';
import { SourceTag } from '../food/SourceTag';
import { daysAgo, Empty, SearchBox } from './shared';

type Flows = ReturnType<typeof useFoodFlows>;
type SourceFilter = 'all' | 'label' | 'photo' | 'cnf' | 'usda';
type Sort = 'logged' | 'recent' | 'az' | 'kcal';

const SOURCE_FILTERS: { key: SourceFilter; label: string; sources: FoodSource[] }[] = [
  { key: 'all', label: 'All', sources: [] },
  { key: 'label', label: 'Label', sources: ['label'] },
  { key: 'photo', label: 'Photo', sources: ['screenshot'] },
  { key: 'cnf', label: 'Canada (CNF)', sources: ['cnf'] },
  { key: 'usda', label: 'USDA', sources: ['usda'] },
];
const SORTS: { key: Sort; label: string }[] = [
  { key: 'logged', label: 'Most logged' },
  { key: 'recent', label: 'Recently logged' },
  { key: 'az', label: 'A–Z' },
  { key: 'kcal', label: 'Calories' },
];

const COLS = 'grid grid-cols-[minmax(0,2.2fr)_88px_minmax(0,1.2fr)_64px_136px_64px] items-center gap-x-3';

function perDefault(f: Food) {
  return computePortion(f, f.defaultPortion.quantity, f.defaultPortion.unit);
}

/** Recipes and meals that use the food — "Used in" on its detail. */
function usedIn(lib: FoodLibrary, foodId: string): string[] {
  return [
    ...lib.recipes.filter((r) => !r.archived && r.ingredients.some((i) => i.foodId === foodId)).map((r) => r.name),
    ...lib.meals.filter((m) => !m.archived && m.items.some((i) => i.kind === 'food' && i.refId === foodId)).map((m) => m.name),
  ];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-divider pt-3">
      <div className="text-xs font-semibold tracking-[0.05em] text-muted uppercase">{title}</div>
      {children}
    </section>
  );
}

/** One food in full (LibraryFoods detail): values, servings, aliases, barcode, history, actions. */
function FoodDetail({ food, lib, today, flows, slot, onDeleted }: { food: Food; lib: FoodLibrary; today: string; flows: Flows; slot: string; onDeleted: () => void }) {
  const m = useFoodMutations();
  const [confirm, setConfirm] = useState(false);
  const p = perDefault(food);
  const usage = itemUsage(lib, { kind: 'food', id: food.id });
  const uses = usedIn(lib, food.id);
  const n = p?.nutrients;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold">{food.name}</div>
          <div className="text-xs text-muted">
            {food.brand ? `${food.brand} · ` : ''}
            {SOURCE_LINE[food.source]}
            {food.sourceRef && (food.source === 'cnf' || food.source === 'usda') ? ` #${food.sourceRef}` : ''} · {formatShortDate(new Date(food.createdAt).toLocaleDateString('en-CA'))}
          </div>
        </div>
        <Button size="sm" onClick={() => flows.setFlow({ kind: 'editFood', food })}>
          Edit
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            ['kcal', n ? fmtKcal(n.kcal) : '—'],
            ['Protein', n ? `${fmtG(n.protein)} g` : '—'],
            ['Carbs', n ? `${fmtG(n.carbs)} g` : '—'],
            ['Fat', n ? `${fmtG(n.fat)} g` : '—'],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-[10px] bg-surface-2 px-2 py-2">
            <div className="text-[11px] text-muted">{label}</div>
            <div className="font-mono text-[15px] font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="-mt-1 text-xs text-muted">Per {formatPortion(food.defaultPortion.quantity, food.defaultPortion.unit)}</div>

      <Section title="Serving sizes">
        <div className="text-[13px]">
          One serving{food.servingLabel ? ` (${food.servingLabel})` : ''}
          {food.measures
            .filter((x) => x.unit !== 'serving')
            .map((x, i) => (
              <span key={`${x.unit}-${i}`}>
                {' = '}
                <span className="font-mono">{formatPortion(x.amount, x.unit)}</span>
              </span>
            ))}
        </div>
        <div className="text-xs text-muted">Default portion: {formatPortion(food.defaultPortion.quantity, food.defaultPortion.unit)}</div>
      </Section>

      <Section title="Also found as">
        <div className="text-[13px]">{food.aliases.length ? food.aliases.join(', ') : <span className="text-muted">No aliases — add some so “log with AI” finds it.</span>}</div>
      </Section>

      <Section title="Barcode">
        <div className="flex items-center gap-1.5 text-[13px]">
          <BarcodeIcon size={16} className="text-muted" />
          {food.barcodes.length ? `${food.barcodes.join(', ')} · on file` : <span className="text-muted">None — scan one to skip AI next time</span>}
        </div>
      </Section>

      {food.images.length > 0 && (
        <Section title="Photos">
          <FoodPhotos food={food} />
        </Section>
      )}

      <Section title="History">
        <div className="text-[13px]">
          {usage ? (
            <>
              Logged {usage.count}× · last {daysAgo(usage.lastDate, today)}
              <div className="text-xs text-muted">
                Usually {formatPortion(usage.usual.quantity, usage.usual.unit)} ({usage.usual.times} of {usage.usual.of})
              </div>
            </>
          ) : (
            <span className="text-muted">Not logged in the last 180 days.</span>
          )}
          {uses.length > 0 && <div className="text-xs text-muted">Used in: {uses.join(', ')}</div>}
        </div>
      </Section>

      <div className="flex flex-wrap gap-2 border-t border-divider pt-3">
        <Button variant="primary" className="flex-auto" onClick={() => flows.setFlow({ kind: 'log', slot, preselect: { kind: 'food', id: food.id } })}>
          Log to today
        </Button>
        {confirm ? (
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button variant="danger" disabled={m.archiveFood.isPending} onClick={() => m.archiveFood.mutate(food.id, { onSuccess: onDeleted })}>
              {m.archiveFood.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        ) : (
          <Button variant="danger" aria-label={`Delete ${food.name}`} onClick={() => setConfirm(true)}>
            <TrashIcon />
          </Button>
        )}
      </div>
      {confirm && <div className="text-xs text-muted">Hidden from your foods; days you've logged it keep their values.</div>}
      {m.archiveFood.error && <ErrorNote>{errorMessage(m.archiveFood.error)}</ErrorNote>}
    </div>
  );
}

/**
 * Library › Foods: the user's foods as a table — search, source filter, sort — and the
 * selected one in a side panel (a sheet on phones). Foods start empty (rule 1a).
 */
export function FoodsTab({ lib, flows, today, slot, mobile }: { lib: FoodLibrary; flows: Flows; today: string; slot: string; mobile: boolean }) {
  const [q, setQ] = useState('');
  const [src, setSrc] = useState<SourceFilter>('all');
  const [sort, setSort] = useState<Sort>('logged');
  const [selected, setSelected] = useState<string | null>(null);

  const foods = useMemo(() => {
    const filter = SOURCE_FILTERS.find((f) => f.key === src)!.sources;
    const active = lib.foods.filter((f) => !f.archived && (!filter.length || filter.includes(f.source)));
    if (q.trim()) return rankByUse(active, q, (f) => itemUsage(lib, { kind: 'food', id: f.id }), today);
    const use = (f: Food) => itemUsage(lib, { kind: 'food', id: f.id });
    const sorted = [...active];
    if (sort === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'kcal') sorted.sort((a, b) => (perDefault(b)?.nutrients.kcal ?? 0) - (perDefault(a)?.nutrients.kcal ?? 0));
    else if (sort === 'recent') sorted.sort((a, b) => (use(b)?.lastDate ?? '').localeCompare(use(a)?.lastDate ?? '') || a.name.localeCompare(b.name));
    else sorted.sort((a, b) => (use(b)?.count ?? 0) - (use(a)?.count ?? 0) || a.name.localeCompare(b.name));
    return sorted;
  }, [lib, q, src, sort, today]);

  const anyFoods = lib.foods.some((f) => !f.archived);
  const current = foods.find((f) => f.id === selected) ?? (mobile ? undefined : foods[0]);

  const toolbar = (
    <div className="flex flex-col gap-2.5">
      <SearchBox value={q} onChange={setQ} placeholder="Search name, brand, alias or barcode">
        <Button aria-label="Scan a barcode" onClick={() => flows.barcode('edit', slot)}>
          <BarcodeIcon size={16} /> {!mobile && 'Scan'}
        </Button>
      </SearchBox>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex scrollbar-none gap-1.5 overflow-x-auto">
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={src === f.key}
              onClick={() => setSrc(f.key)}
              className={`min-h-8 shrink-0 rounded-full border px-3 text-[13px] whitespace-nowrap mobile:min-h-[36px] ${src === f.key ? 'border-ink bg-ink font-semibold text-white' : 'border-line-strong bg-surface text-ink'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={flows.replayIntro} className="ml-auto min-h-8 border-0 bg-transparent p-0 text-[13px] font-medium text-accent-ink mobile:min-h-[36px]">
          How food logging works
        </button>
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} disabled={!!q.trim()} className="min-h-8 rounded-lg border border-line-strong bg-surface px-2 text-ink mobile:min-h-[36px]">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );

  const empty = (
    <Empty>
      {anyFoods
        ? q
          ? `No food matches “${q}”.`
          : 'No foods from this source.'
        : 'Your foods start empty — only what you add goes in. Add a staple, read a label, or enter one by hand.'}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => flows.staples(q, slot)}>
          Search staples
        </Button>
        <Button size="sm" onClick={() => flows.photo(slot)}>
          From a photo
        </Button>
        <Button size="sm" onClick={() => flows.newFood(q, slot)}>
          Enter manually
        </Button>
      </div>
    </Empty>
  );

  if (mobile) {
    return (
      <div className="flex flex-col gap-3">
        {toolbar}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => flows.photo(slot)}>Photo of label</Button>
          <Button onClick={() => flows.staples('', slot)}>Add a staple</Button>
        </div>
        {foods.length ? (
          <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
            {foods.map((f) => {
              const p = perDefault(f);
              const usage = itemUsage(lib, { kind: 'food', id: f.id });
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelected(f.id)}
                  className="flex min-h-[60px] w-full items-center gap-3 border-0 border-b border-divider bg-transparent px-3.5 py-2 text-left text-ink last:border-b-0"
                >
                  <span className="min-w-0 flex-auto">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{f.name}</span>
                      <SourceTag source={f.source} />
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {formatPortion(f.defaultPortion.quantity, f.defaultPortion.unit)}
                      {usage ? ` · ${usage.count}×` : ''}
                    </span>
                  </span>
                  <span className="font-mono text-[13px]">{p ? fmtKcal(p.nutrients.kcal) : '—'}</span>
                  <ChevronRight className="flex-none text-muted" />
                </button>
              );
            })}
          </div>
        ) : (
          empty
        )}
        {current && (
          <Sheet title={current.name} eyebrow="Food" onClose={() => setSelected(null)} tall>
            <FoodDetail food={current} lib={lib} today={today} flows={flows} slot={slot} onDeleted={() => setSelected(null)} />
          </Sheet>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-7 pt-4">
        {toolbar}
        {foods.length ? (
          <div role="listbox" aria-label="Your foods" className="min-h-0 flex-1 overflow-auto rounded-t-[14px] border border-b-0 border-line bg-surface">
            <div className={`${COLS} sticky top-0 z-[1] border-b border-line bg-surface-alt px-4 py-2 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase`}>
              <div>Food</div>
              <div>Source</div>
              <div>Default serving</div>
              <div className="text-right">kcal</div>
              <div className="text-right">P · C · F (g)</div>
              <div className="text-right">Logged</div>
            </div>
            {foods.map((f) => {
              const p = perDefault(f);
              const usage = itemUsage(lib, { kind: 'food', id: f.id });
              const on = current?.id === f.id;
              return (
                <div
                  key={f.id}
                  role="option"
                  aria-selected={on}
                  tabIndex={0}
                  onClick={() => setSelected(f.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSelected(f.id))}
                  className={`${COLS} min-h-[52px] cursor-pointer border-b border-divider px-4 py-1.5 text-[13px] ${on ? 'bg-accent-tint' : 'hover:bg-surface-2'}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate font-medium">
                      <span className="truncate">{f.name}</span>
                      {f.barcodes.length > 0 && <BarcodeIcon size={13} className="flex-none text-muted" aria-label="Barcode on file" />}
                    </div>
                    <div className="truncate text-xs text-muted">{usage ? `logged ${daysAgo(usage.lastDate, today)}` : f.brand ?? 'not logged yet'}</div>
                  </div>
                  <div>
                    <SourceTag source={f.source} />
                  </div>
                  <div className="truncate text-muted">{formatPortion(f.defaultPortion.quantity, f.defaultPortion.unit)}</div>
                  <div className="text-right font-mono">{p ? fmtKcal(p.nutrients.kcal) : '—'}</div>
                  <div className="text-right font-mono whitespace-nowrap text-muted">{p ? `${fmtG(p.nutrients.protein)} · ${fmtG(p.nutrients.carbs)} · ${fmtG(p.nutrients.fat)}` : '—'}</div>
                  <div className="text-right font-mono">{usage ? `${usage.count}×` : '—'}</div>
                </div>
              );
            })}
          </div>
        ) : (
          empty
        )}
      </div>
      {current && (
        <aside aria-label="Food details" className="w-[360px] flex-none overflow-auto border-l border-line bg-surface p-4">
          <FoodDetail key={current.id} food={current} lib={lib} today={today} flows={flows} slot={slot} onDeleted={() => setSelected(null)} />
        </aside>
      )}
    </div>
  );
}
