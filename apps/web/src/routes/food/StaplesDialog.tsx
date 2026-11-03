import { defaultPortionIndex, foodFromStaple, parsePortionLabel, scaleNutrients, stapleKcal } from '@cycling-coach/core';
import type { Food, StapleResult, StapleSource } from '@cycling-coach/shared';
import { useEffect, useId, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { ChevronLeft } from '../../components/icons';
import { Button, ErrorNote, Spinner, inputCls } from '../../components/ui';
import { fmtG, fmtKcal } from '../../lib/food';
import { useFoodMutations, useStapleDetail, useStapleSearch } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';

const TAG: Record<StapleSource, { label: string; bg: string; fg: string; line: string }> = {
  cnf: { label: 'Canada', bg: '#ECFDF3', fg: '#085D3A', line: 'Canadian Nutrient File (Health Canada)' },
  usda: { label: 'USDA', bg: '#EEF0F3', fg: '#4B5563', line: 'USDA FoodData Central' },
};

function Detail({ hit, onSaved }: { hit: StapleResult; onSaved: (food: Food, log: boolean) => void }) {
  const id = useId();
  const detail = useStapleDetail(hit.source, hit.ref);
  const m = useFoodMutations();
  const [name, setName] = useState(hit.name);
  const [choice, setChoice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = detail.data;
  useEffect(() => {
    if (d && choice === null) setChoice(defaultPortionIndex(d.portions));
  }, [d, choice]);

  if (detail.isPending) return <Spinner />;
  if (detail.error || !d) return <ErrorNote>{errorMessage(detail.error)}</ErrorNote>;

  // Weights ("50 g") are redundant next to 100 g; everything else becomes a serving size.
  const rows = d.portions.map((p, i) => ({ ...p, i })).filter((p) => parsePortionLabel(p.label) && !parsePortionLabel(p.label)!.isMass);
  const picked = choice ?? -1;
  const grams = picked >= 0 ? d.portions[picked]!.grams : 100;
  const n = scaleNutrients(d.per100g, grams / 100);

  const save = (log: boolean) =>
    m.createFood.mutate(foodFromStaple(d, { name, defaultIndex: picked }), { onSuccess: (f) => onSaved(f, log), onError: (e) => setError(errorMessage(e)) });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-[13px] font-medium text-muted" htmlFor={`${id}-name`}>
        Save as
        <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </label>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-semibold">Serving sizes from the source</legend>
        {[{ label: '100 g', grams: 100, i: -1 }, ...rows].map((p) => (
          <label
            key={p.i}
            className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 ${picked === p.i ? 'border-accent-ring bg-accent-tint' : 'border-line bg-surface'}`}
          >
            <input type="radio" name={`${id}-serv`} checked={picked === p.i} onChange={() => setChoice(p.i)} className="accent-accent-ink" />
            <span className="flex-auto text-[13px]">
              {p.label}
              {p.i >= 0 && <span className="text-muted"> · {fmtG(p.grams)} g</span>}
            </span>
            <span className="font-mono text-[13px]">{stapleKcal(d.per100g, p.grams)} kcal</span>
          </label>
        ))}
        <span className="text-xs text-muted">The checked one is your usual portion; all of them are kept as serving sizes.</span>
      </fieldset>
      <div className="grid grid-cols-4 gap-2 rounded-[10px] bg-surface-2 p-3 text-center">
        {(
          [
            ['Calories', fmtKcal(n.kcal), ''],
            ['Protein', fmtG(n.protein), ' g'],
            ['Carbs', fmtG(n.carbs), ' g'],
            ['Fat', fmtG(n.fat), ' g'],
          ] as const
        ).map(([l, v, u]) => (
          <div key={l}>
            <div className="text-[11px] text-muted">{l}</div>
            <div className="font-mono font-semibold">
              {v}
              {u}
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted">
        Source: {TAG[d.source].line} · {d.name}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <Button disabled={m.createFood.isPending || !name.trim()} onClick={() => save(false)}>
          Save
        </Button>
        <Button variant="primary" disabled={m.createFood.isPending || !name.trim()} onClick={() => save(true)}>
          Save &amp; log
        </Button>
      </div>
    </div>
  );
}

function ResultList({ results, selected, onPick }: { results: StapleResult[]; selected: StapleResult | null; onPick: (r: StapleResult) => void }) {
  return (
    <div role="listbox" aria-label="Staples" className="flex flex-none flex-col overflow-hidden rounded-[10px] border border-line">
      {results.map((r) => {
        const on = selected?.source === r.source && selected.ref === r.ref;
        return (
          <button
            key={`${r.source}:${r.ref}`}
            type="button"
            role="option"
            aria-selected={on}
            onClick={() => onPick(r)}
            className={`flex min-h-14 w-full items-center gap-3 border-0 border-b border-divider px-3 py-2 text-left text-ink last:border-b-0 ${on ? 'bg-accent-tint' : 'bg-surface hover:bg-surface-2'}`}
          >
            <span className="min-w-0 flex-auto">
              <span className="block font-medium">{r.name}</span>
              <span className="block text-xs text-muted">
                {r.group ? `${r.group} · ` : ''}per 100 g: {fmtKcal(r.kcalPer100g)} kcal
              </span>
            </span>
            <span className="flex-none rounded-[5px] px-1.5 text-[10px] leading-[17px] font-bold" style={{ background: TAG[r.source].bg, color: TAG[r.source].fg }}>
              {TAG[r.source].label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Add a staple: flour, sugar, eggs, bananas — from the Canadian Nutrient File
 * first, USDA FoodData Central when Canada has nothing. Picking one saves it to the user's foods.
 */
export function StaplesDialog({ initialQuery = '', onClose, onSaved }: { initialQuery?: string; onClose: () => void; onSaved: (food: Food, log: boolean) => void }) {
  const mobile = useIsMobile();
  const [input, setInput] = useState(initialQuery);
  const [q, setQ] = useState(initialQuery.trim());
  const [usda, setUsda] = useState(false);
  const [selected, setSelected] = useState<StapleResult | null>(null);
  const cnf = useStapleSearch(q, 'cnf');
  const cnfEmpty = cnf.isSuccess && !cnf.data.results.length;
  const us = useStapleSearch(q, 'usda', usda || cnfEmpty);

  const search = () => {
    setQ(input.trim());
    setUsda(false);
    setSelected(null);
  };

  const results = [...(cnf.data?.results ?? []), ...(us.data?.results ?? [])];
  const status = (
    <>
      {cnf.data?.unavailable && <ErrorNote>{cnf.data.unavailable}</ErrorNote>}
      {us.data?.unavailable && <ErrorNote>{us.data.unavailable}</ErrorNote>}
      {(cnf.isFetching || us.isFetching) && <Spinner label="Searching…" />}
      {q.length >= 2 && !cnf.isFetching && !us.isFetching && !results.length && <div className="text-[13px] text-muted">Nothing found for “{q}”. Try fewer words (“flour”, not “all-purpose white flour”).</div>}
      {cnf.isSuccess && cnf.data.results.length > 0 && !usda && (
        <button type="button" onClick={() => setUsda(true)} className="self-start border-0 bg-transparent p-0 text-[13px] font-medium text-accent-ink">
          Not here? Also search USDA
        </button>
      )}
    </>
  );

  const searchBar = (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        search();
      }}
    >
      <input type="search" aria-label="Search staple foods" placeholder="large egg, all-purpose flour, banana…" value={input} onChange={(e) => setInput(e.target.value)} className={`${inputCls} flex-auto`} autoFocus={!mobile} />
      <Button type="submit" variant="primary" disabled={input.trim().length < 2}>
        Search
      </Button>
    </form>
  );
  const blurb = <div className="text-xs text-muted">Searches the Canadian Nutrient File (Health Canada) first, then USDA FoodData Central. Whatever you pick is saved to your foods.</div>;

  if (mobile) {
    return (
      <Dialog title="Add a staple food" onClose={onClose} tall>
        {selected ? (
          <>
            <button type="button" onClick={() => setSelected(null)} className="flex min-h-[44px] items-center gap-1 self-start border-0 bg-transparent p-0 font-medium text-accent-ink">
              <ChevronLeft /> Results
            </button>
            <Detail key={`${selected.source}:${selected.ref}`} hit={selected} onSaved={onSaved} />
          </>
        ) : (
          <>
            {searchBar}
            {blurb}
            {results.length > 0 && <ResultList results={results} selected={selected} onPick={setSelected} />}
            {status}
          </>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog title="Add a staple food" onClose={onClose} width={920} tall header={<div className="mt-3 flex flex-col gap-2">{searchBar}{blurb}</div>}>
      <div className="grid min-h-0 flex-auto grid-cols-[minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)] gap-5">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {results.length > 0 && <ResultList results={results} selected={selected} onPick={setSelected} />}
          {status}
        </div>
        <div className="min-h-0 overflow-y-auto rounded-[12px] border border-line bg-surface-alt p-4">
          {selected ? <Detail key={`${selected.source}:${selected.ref}`} hit={selected} onSaved={onSaved} /> : <div className="p-6 text-center text-[13px] text-muted">Pick a result to see its serving sizes.</div>}
        </div>
      </div>
    </Dialog>
  );
}
