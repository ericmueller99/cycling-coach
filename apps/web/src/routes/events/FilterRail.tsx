import { DEFAULT_EVENT_FILTERS, type EventFilters, type EventQueryResult } from '@cycling-coach/shared';
import { useEffect, useId, useState } from 'react';
import { XIcon } from '../../components/icons';
import { Button } from '../../components/ui';
import { errorMessage, useEventSearches } from '../../lib/queries';
import {
  ForMeSection,
  LengthSection,
  PensSection,
  PopularitySection,
  RulesSection,
  SectionTitle,
  SeriesSection,
  StatusSection,
  TerrainSection,
  TypeSection,
  UnlocksSection,
  WhenSection,
  WorldSection,
  type SetFilters,
} from './controls';

/** Typing waits a moment before it filters, so each keystroke isn't a query. */
export function useDebouncedSearch(f: EventFilters, set: SetFilters) {
  const [q, setQ] = useState(f.q);
  useEffect(() => setQ(f.q), [f.q]);
  useEffect(() => {
    if (q === f.q) return;
    const t = setTimeout(() => set({ ...f, q }), 250);
    return () => clearTimeout(t);
  }, [q, f, set]);
  return [q, setQ] as const;
}

export function SavedSearches({ f, set, mobile }: { f: EventFilters; set: SetFilters; mobile?: boolean }) {
  const { list, create, remove } = useEventSearches();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const save = () => {
    if (!name.trim()) return;
    create.mutate({ name: name.trim().slice(0, 40), filters: f }, { onSuccess: () => (setNaming(false), setName('')) });
  };
  const chip = mobile ? 'min-h-[36px]' : 'min-h-8';
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle mobile={mobile}>Saved searches</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {list.data?.map((s) => (
          <span key={s.id} className={`flex ${chip} items-center rounded-full border border-line-strong bg-surface text-[13px]`}>
            <button type="button" onClick={() => set(s.filters)} className="h-full border-0 bg-transparent pr-1 pl-2.5 text-ink">
              {s.name}
            </button>
            <button type="button" aria-label={`Delete saved search ${s.name}`} onClick={() => remove.mutate(s.id)} className="flex h-full items-center border-0 bg-transparent pr-2 pl-1 text-muted">
              <XIcon size={12} />
            </button>
          </span>
        ))}
        {!naming && (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className={`${chip} rounded-full border border-dashed border-[#C5CBD4] bg-transparent px-2.5 text-[13px] font-semibold text-accent-ink`}
          >
            + Save current
          </button>
        )}
      </div>
      {naming && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            aria-label="Name this search"
            placeholder="e.g. Evening B races"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
            className="min-h-9 min-w-0 flex-auto rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink mobile:min-h-[44px] mobile:text-base"
          />
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim() || create.isPending}>
            Save
          </Button>
        </form>
      )}
      {create.error && <div className="text-xs text-danger">{errorMessage(create.error)}</div>}
    </div>
  );
}

/** Desktop filter rail: 300px, its own scroll. */
export function FilterRail({
  f,
  set,
  facets,
  z2,
}: {
  f: EventFilters;
  set: SetFilters;
  facets: EventQueryResult['facets'] | undefined;
  z2?: string | undefined;
}) {
  const id = useId();
  const [q, setQ] = useDebouncedSearch(f, set);
  return (
    <aside aria-label="Filters" className="flex min-h-0 w-[300px] flex-none flex-col gap-[18px] overflow-y-auto border-r border-line pt-5 pr-5 pb-7 pl-7">
      <SavedSearches f={f} set={set} />
      <div className="flex flex-col gap-1">
        <SectionTitle htmlFor={`${id}-q`}>Search</SectionTitle>
        <input
          id={`${id}-q`}
          type="search"
          placeholder="Name, route, organiser, series"
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
          className="min-h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-ink"
        />
      </div>
      <WhenSection f={f} set={set} />
      <TypeSection f={f} set={set} facets={facets} />
      <LengthSection f={f} set={set} />
      <TerrainSection f={f} set={set} />
      <WorldSection f={f} set={set} facets={facets} />
      <PopularitySection f={f} set={set} />
      <ForMeSection f={f} set={set} z2={z2} />
      <PensSection f={f} set={set} />
      <RulesSection f={f} set={set} />
      <UnlocksSection f={f} set={set} />
      <SeriesSection f={f} set={set} />
      <StatusSection f={f} set={set} />
      <Button onClick={() => set(DEFAULT_EVENT_FILTERS)}>Reset all filters</Button>
    </aside>
  );
}
