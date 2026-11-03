import { formatPortion, macroSplit } from '@cycling-coach/core';
import type { FoodLibrary, Recipe } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { PlusIcon } from '../../components/icons';
import { MacroBar } from '../../components/MacroBar';
import { Button, Card } from '../../components/ui';
import { fmtG, fmtKcal, itemUsage } from '../../lib/food';
import type { useFoodFlows } from '../food/flows';
import { Empty, SearchBox } from './shared';

type Sort = 'logged' | 'recent' | 'az' | 'protein';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'logged', label: 'Most logged' },
  { key: 'recent', label: 'Recently made' },
  { key: 'az', label: 'A–Z' },
  { key: 'protein', label: 'Protein per serving' },
];

/** Library › Recipes: cards with per-serving energy, macro split and ingredients; a card opens its page. */
export function RecipesTab({ lib, flows, slot, today: _today, onEdit }: { lib: FoodLibrary; flows: ReturnType<typeof useFoodFlows>; slot: string; today: string; onEdit: (r: Recipe | 'new') => void }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('logged');
  const recipes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const foodName = (id: string) => lib.foods.find((f) => f.id === id)?.name ?? '';
    const list = lib.recipes.filter(
      (r) => !r.archived && (!needle || r.name.toLowerCase().includes(needle) || r.ingredients.some((i) => foodName(i.foodId).toLowerCase().includes(needle))),
    );
    const use = (r: Recipe) => itemUsage(lib, { kind: 'recipe', id: r.id });
    if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'protein') list.sort((a, b) => b.totals.perServing.protein - a.totals.perServing.protein);
    else if (sort === 'recent') list.sort((a, b) => (use(b)?.lastDate ?? b.updatedAt).localeCompare(use(a)?.lastDate ?? a.updatedAt));
    else list.sort((a, b) => (use(b)?.count ?? 0) - (use(a)?.count ?? 0) || a.name.localeCompare(b.name));
    return list;
  }, [lib, q, sort]);

  return (
    <div className="flex flex-col gap-4 mobile:gap-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search recipes or ingredients">
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-9 rounded-lg border border-line-strong bg-surface px-2 text-ink mobile:min-h-[44px]">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </SearchBox>
      {recipes.length === 0 && !lib.recipes.some((r) => !r.archived) ? (
        <Empty>
          No recipes yet. Build one from your foods — overnight oats, a batch of chili — and log it by the serving or by weight.
          <div className="mt-3">
            <Button size="sm" variant="primary" onClick={() => onEdit('new')}>
              <PlusIcon /> New recipe
            </Button>
          </div>
        </Empty>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
          {recipes.map((r) => {
            const usage = itemUsage(lib, { kind: 'recipe', id: r.id });
            const per = r.totals.perServing;
            const split = macroSplit(per);
            return (
              <Card key={r.id} className="flex flex-col gap-2.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to="/library/recipes/$id" params={{ id: r.id }} className="text-[16px] font-semibold text-ink hover:text-accent-ink">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">
                      Makes {r.servings} serving{r.servings === 1 ? '' : 's'}
                      {r.finishedGrams ? ` · ${fmtKcal(r.finishedGrams)} g batch` : ''}
                      {usage ? ` · logged ${usage.count}×` : ''}
                      {r.totals.problems.length ? ' · needs a look' : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[20px] leading-tight font-semibold">{fmtKcal(per.kcal)}</div>
                    <div className="text-[11px] text-muted">kcal / serving</div>
                  </div>
                </div>
                <MacroBar {...split} />
                <div className="font-mono text-xs text-muted">
                  P {fmtG(per.protein)} g · C {fmtG(per.carbs)} g · F {fmtG(per.fat)} g
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.ingredients.map((i, n) => (
                    <span key={`${i.foodId}-${n}`} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">
                      {i.label ?? lib.foods.find((f) => f.id === i.foodId)?.name ?? 'Missing food'} {formatPortion(i.quantity, i.unit)}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex gap-2 pt-1">
                  <Button size="sm" variant="primary" className="flex-auto" onClick={() => flows.setFlow({ kind: 'log', slot, preselect: { kind: 'recipe', id: r.id } })}>
                    Log a serving
                  </Button>
                  <Link
                    to="/library/recipes/$id"
                    params={{ id: r.id }}
                    className="inline-flex min-h-9 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink mobile:min-h-[44px]"
                  >
                    {r.steps?.length ? 'Recipe' : 'Open'}
                  </Link>
                  <Button size="sm" onClick={() => onEdit(r)}>
                    Edit
                  </Button>
                </div>
              </Card>
            );
          })}
          {!q && (
            <button
              type="button"
              onClick={() => onEdit('new')}
              className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-[#C5CBD4] bg-transparent text-muted"
            >
              <span className="font-semibold text-ink">+ New recipe</span>
              <span className="text-[13px]">From your foods, logged by the serving or by weight</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
