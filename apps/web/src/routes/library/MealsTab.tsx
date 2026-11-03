import { computePortion, formatPortion, formatShortDate } from '@cycling-coach/core';
import type { FoodLibrary, Meal } from '@cycling-coach/shared';
import { useMemo, useState } from 'react';
import { PlusIcon } from '../../components/icons';
import { Button, Card } from '../../components/ui';
import { findLoggable, fmtKcal, itemUsage, macroLine } from '../../lib/food';
import type { useFoodFlows } from '../food/flows';
import { Empty, SearchBox } from './shared';

const UNASSIGNED = 'Unassigned';

/** Library › Meals: saved combos by slot; logging one writes each item separately. */
export function MealsTab({ lib, flows, slot, mobile, onEdit }: { lib: FoodLibrary; flows: ReturnType<typeof useFoodFlows>; slot: string; mobile: boolean; onEdit: (m: Meal | 'new') => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('All');
  const active = lib.meals.filter((m) => !m.archived);
  const slots = [...lib.settings.slots.map((s) => s.name), ...(active.some((m) => !m.slot) ? [UNASSIGNED] : [])];
  const meals = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return active.filter((m) => (filter === 'All' || (m.slot ?? UNASSIGNED) === filter) && (!needle || m.name.toLowerCase().includes(needle)));
  }, [active, q, filter]);

  return (
    <div className="flex max-w-[1100px] flex-col gap-4 mobile:gap-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search meals" />
      <div className="flex scrollbar-none gap-1.5 overflow-x-auto">
        {['All', ...slots].map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={filter === s}
            onClick={() => setFilter(s)}
            className={`min-h-8 shrink-0 rounded-full border px-3 text-[13px] whitespace-nowrap mobile:min-h-[36px] ${filter === s ? 'border-ink bg-ink font-semibold text-white' : 'border-line-strong bg-surface text-ink'}`}
          >
            {s}
          </button>
        ))}
      </div>
      {active.length === 0 ? (
        <Empty>
          No saved meals yet. Save your usual breakfast once and log it in one tap — or use “Save as meal” on a day you've logged.
          <div className="mt-3">
            <Button size="sm" variant="primary" onClick={() => onEdit('new')}>
              <PlusIcon /> New meal
            </Button>
          </div>
        </Empty>
      ) : meals.length === 0 ? (
        <Empty>No meals here.</Empty>
      ) : (
        meals.map((m) => {
          const usage = itemUsage(lib, { kind: 'meal', id: m.id });
          const logSlot = m.slot ?? slot;
          return (
            <Card key={m.id} className={`flex gap-4 p-4 ${mobile ? 'flex-col' : ''}`}>
              <div className="flex min-w-0 flex-auto flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[16px] font-semibold">{m.name}</span>
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{m.slot ?? UNASSIGNED}</span>
                </div>
                <div className="flex flex-col">
                  {m.items.map((it, n) => {
                    const l = findLoggable(lib, it.kind, it.refId);
                    const p = l ? computePortion(l, it.quantity, it.unit) : null;
                    return (
                      <div key={`${it.refId}-${n}`} className="flex items-center gap-2 border-b border-divider py-1.5 text-[13px] last:border-b-0">
                        <span className="min-w-0 flex-auto truncate">
                          {l?.name ?? 'Missing item'} <span className="text-muted">· {formatPortion(it.quantity, it.unit)}</span>
                        </span>
                        {it.kind === 'recipe' && <span className="rounded-md bg-[#FFF4E5] px-1.5 text-[11px] font-semibold text-[#B54708]">Recipe</span>}
                        <span className="w-14 text-right font-mono text-muted">{p ? fmtKcal(p.nutrients.kcal) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="text-xs text-muted">{usage ? `Logged ${usage.count}× · last ${formatShortDate(usage.lastDate)}` : 'Not logged yet'}</div>
              </div>
              <div className={`flex flex-none flex-col gap-2 ${mobile ? '' : 'w-[220px] border-l border-divider pl-4'}`}>
                <div>
                  <div className="font-mono text-[22px] leading-tight font-semibold">{fmtKcal(m.total.kcal)}</div>
                  <div className="font-mono text-xs text-muted">kcal · {macroLine(m.total)}</div>
                </div>
                <Button size="sm" variant="primary" onClick={() => flows.setFlow({ kind: 'log', slot: logSlot, preselect: { kind: 'meal', id: m.id } })}>
                  Log to {logSlot}
                </Button>
                <Button size="sm" onClick={() => onEdit(m)}>
                  Edit
                </Button>
              </div>
            </Card>
          );
        })
      )}
      <div className="text-xs text-muted">Logging a meal adds each item separately, so you can change one on the day.</div>
    </div>
  );
}
