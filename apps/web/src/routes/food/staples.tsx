import { defaultPortionIndex, foodFromStaple, type Loggable } from '@cycling-coach/core';
import type { StapleResult } from '@cycling-coach/shared';
import { useEffect, useMemo, useState } from 'react';
import { fmtKcal } from '../../lib/food';
import { useStapleDetail, useStapleSearch } from '../../lib/foodQueries';

/**
 * "Include staples", shared by Log food and the recipe / meal builders: a switch,
 * a green section of CNF (then USDA) matches after the user's own results, and the staple-as-a-food
 * shape used to price a portion before anything is saved. Nothing here writes — a staple only
 * becomes one of their foods when they click a save button (rule 1a).
 */

/** Below this many foods, staples are on by default — an empty database is never a dead end. */
export const FEW_FOODS = 25;

function readPref(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch {
    return null;
  }
}

function writePref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Whether staples show, and the staple search for `query`. The user's choice once they've made
 * one; on while their foods are few; on for one search when their own foods have nothing for it.
 */
export function useIncludeStaples({
  storageKey,
  activeFoods,
  query,
  ownResults,
  initialOn,
}: {
  storageKey: string;
  activeFoods: number;
  query: string;
  ownResults: number;
  initialOn?: boolean | undefined;
}) {
  const [pref, setPref] = useState<boolean | null>(() => (initialOn ? true : readPref(storageKey)));
  const [forceFor, setForceFor] = useState<string | null>(null);
  const staplesOn = (pref ?? activeFoods < FEW_FOODS) || (query.length >= 2 && (!ownResults || forceFor === query));
  const dq = useDebounced(query, 250);
  // CNF runs even when off, for the "+ Also show staples matching 'q' (N)" count.
  const cnf = useStapleSearch(dq, 'cnf', dq.length >= 2);
  const usda = useStapleSearch(dq, 'usda', staplesOn && cnf.isSuccess && !cnf.data.results.length);
  const hits = [...(cnf.data?.results ?? []), ...(usda.data?.results ?? [])].slice(0, 15);
  const toggle = () => {
    const next = !staplesOn;
    setPref(next);
    setForceFor(null);
    writePref(storageKey, next);
  };
  return {
    staplesOn,
    toggle,
    showFor: setForceFor,
    hits,
    searching: cnf.isFetching || usda.isFetching || dq !== query,
    unavailable: cnf.data?.unavailable ?? usda.data?.unavailable,
    cnfCount: cnf.data?.results.length ?? 0,
  };
}
export type IncludeStaples = ReturnType<typeof useIncludeStaples>;

/** The staple as a not-yet-saved food: the `FoodInput` to save and a `Loggable` to price portions. */
export function useStapleFood(hit: StapleResult, name: string) {
  const detail = useStapleDetail(hit.source, hit.ref);
  const d = detail.data;
  const input = useMemo(() => (d ? foodFromStaple(d, { name: hit.name, defaultIndex: defaultPortionIndex(d.portions) }) : null), [d, hit.name]);
  const loggable: Loggable | null = input
    ? { kind: 'food', id: 'staple', name, source: input.source, measures: input.measures, defaultPortion: input.defaultPortion, nutrients: input.nutrients, servingLabel: input.servingLabel }
    : null;
  return { detail, input, loggable };
}

export const STAPLE_SOURCE_LINE = { cnf: 'Canadian Nutrient File (Health Canada)', usda: 'USDA FoodData Central' } as const;

export function StaplesSwitch({ on, onToggle, className = '' }: { on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`flex min-h-8 flex-none items-center gap-2 self-start rounded-full border-0 bg-transparent px-1 text-[13px] font-medium text-ink ${className}`}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#15803D]" />
      Include staples
      <span className="relative h-[20px] w-[34px] rounded-full" style={{ background: on ? '#3F6212' : '#C5CBD4' }}>
        <span className="absolute top-[3px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left]" style={{ left: on ? 17 : 3 }} />
      </span>
    </button>
  );
}

/**
 * The green staples section after the user's own results, or — when staples are off — a single
 * "+ Also show staples matching 'q' (N)" row. Renders nothing for queries under two characters.
 */
export function StapleHits({
  query,
  staples,
  selected,
  onPick,
  className = 'mt-3',
}: {
  query: string;
  staples: IncludeStaples;
  selected: StapleResult | null;
  onPick: (hit: StapleResult) => void;
  className?: string;
}) {
  if (query.length < 2) return null;
  if (!staples.staplesOn) {
    return staples.cnfCount > 0 ? (
      <button type="button" onClick={() => staples.showFor(query)} className={`flex-none self-start border-0 bg-transparent px-1 py-1 text-[13px] font-medium text-accent-ink ${className}`}>
        + Also show staples matching “{query}” ({staples.cnfCount})
      </button>
    ) : null;
  }
  return (
    <div role="listbox" aria-label="Staples" className={`flex flex-none flex-col overflow-hidden rounded-[10px] border border-[#CFE9D7] ${className}`}>
      <div className="bg-[#F3FAF5] px-3 py-1.5 text-xs text-[#085D3A]">
        <strong>Staples</strong> · Canadian Nutrient File — saved to your foods when you add one
      </div>
      {staples.searching ? (
        <div className="px-3 py-2 text-[13px] text-muted">Searching staples…</div>
      ) : staples.hits.length ? (
        staples.hits.map((hit) => {
          const on = selected?.source === hit.source && selected.ref === hit.ref;
          return (
            <button
              key={`${hit.source}:${hit.ref}`}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => onPick(hit)}
              className={`flex min-h-12 w-full items-center gap-3 border-0 border-t border-divider px-3 py-2 text-left text-ink ${on ? 'bg-accent-tint' : 'bg-surface hover:bg-surface-2'}`}
            >
              <span className="min-w-0 flex-auto">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{hit.name}</span>
                  <span className="flex-none rounded-[5px] px-1.5 text-[10px] leading-[17px] font-bold" style={hit.source === 'cnf' ? { background: '#ECFDF3', color: '#085D3A' } : { background: '#EEF0F3', color: '#4B5563' }}>
                    {hit.source === 'cnf' ? 'Staple' : 'USDA'}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted">not in your foods yet · per 100 g: {fmtKcal(hit.kcalPer100g)} kcal</span>
              </span>
            </button>
          );
        })
      ) : (
        <div className="px-3 py-2 text-[13px] text-muted">{staples.unavailable ?? `No staples match “${query}”.`}</div>
      )}
    </div>
  );
}
