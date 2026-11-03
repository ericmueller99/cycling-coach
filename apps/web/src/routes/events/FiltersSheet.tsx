import { DEFAULT_EVENT_FILTERS, type EventFilters, type EventQueryResult } from '@cycling-coach/shared';
import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { Button } from '../../components/ui';
import { activeChips } from '../../lib/events';
import {
  ForMeSection,
  LengthSection,
  PensSection,
  PopularitySection,
  RulesSection,
  SeriesSection,
  StatusSection,
  TerrainSection,
  TypeSection,
  UnlocksSection,
  WhenSection,
  WorldSection,
  type SetFilters,
} from './controls';
import { SavedSearches } from './FilterRail';

type Page = 'world' | 'pens' | 'rules' | 'unlocks' | 'series' | 'status' | 'saved';

const PAGES: { key: Page; label: string; keys: string[] }[] = [
  { key: 'world', label: 'World & route', keys: ['world-', 'route'] },
  { key: 'pens', label: 'Category & pens', keys: ['pens', 'pk-', 'basis', 'enforced', 'ranked'] },
  { key: 'rules', label: 'Rules', keys: ['pu', 'late', 'draft', 'tt', 'hrm', 'women'] },
  { key: 'unlocks', label: 'Unlocks', keys: ['ul-'] },
  { key: 'series', label: 'Series', keys: ['series-'] },
  { key: 'status', label: 'My status', keys: ['signed', 'cal'] },
];

function Divided({ children }: { children: ReactNode }) {
  return <div className="border-b border-divider py-3.5 last:border-b-0">{children}</div>;
}

/**
 * Mobile filters (MobileEventFilters): near-full-height sheet, the common sections inline and the
 * rest as drill-in pages. It edits the live filters, so "Show N events" just closes.
 */
export function FiltersSheet({
  f,
  set,
  facets,
  total,
  z2,
  onClose,
}: {
  f: EventFilters;
  set: SetFilters;
  facets: EventQueryResult['facets'] | undefined;
  total: number | undefined;
  z2?: string | undefined;
  onClose: () => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const chips = activeChips(f);
  const valueOf = (keys: string[]) => {
    const hits = chips.filter((c) => keys.some((k) => c.key === k || (k.endsWith('-') && c.key.startsWith(k))));
    if (keys.includes('women') && f.hideWomenOnly && !hits.length) return 'Hide women-only';
    return hits.length ? hits.map((c) => c.label).join(', ') : 'Any';
  };
  const current = PAGES.find((p) => p.key === page);

  return (
    <Sheet
      tall
      title={page ? (current?.label ?? 'Saved searches') : 'Filters'}
      onClose={onClose}
      action={
        page ? (
          <button type="button" onClick={() => setPage(null)} className="flex items-center gap-1 border-0 bg-transparent px-2 text-[15px] font-semibold text-accent-ink">
            <ChevronLeft size={16} /> All filters
          </button>
        ) : (
          <button type="button" onClick={() => set(DEFAULT_EVENT_FILTERS)} className="border-0 bg-transparent px-2 text-[15px] font-semibold text-accent-ink">
            Reset
          </button>
        )
      }
      footer={
        <div className="flex gap-2.5">
          <Button size="lg" className="min-h-[50px] rounded-xl" onClick={() => setPage('saved')}>
            Save
          </Button>
          <Button size="lg" variant="primary" className="min-h-[50px] flex-auto rounded-xl" onClick={onClose}>
            Show {total ?? '…'} event{total === 1 ? '' : 's'}
          </Button>
        </div>
      }
    >
      {page === 'saved' ? (
        <SavedSearches f={f} set={set} mobile />
      ) : page === 'world' ? (
        <WorldSection f={f} set={set} facets={facets} mobile />
      ) : page === 'pens' ? (
        <PensSection f={f} set={set} mobile />
      ) : page === 'rules' ? (
        <RulesSection f={f} set={set} mobile />
      ) : page === 'unlocks' ? (
        <UnlocksSection f={f} set={set} mobile />
      ) : page === 'series' ? (
        <SeriesSection f={f} set={set} mobile />
      ) : page === 'status' ? (
        <StatusSection f={f} set={set} mobile />
      ) : (
        <div className="-mt-3.5 flex flex-col">
          <Divided>
            <ForMeSection f={f} set={set} z2={z2} mobile />
          </Divided>
          <Divided>
            <WhenSection f={f} set={set} mobile />
          </Divided>
          <Divided>
            <TypeSection f={f} set={set} facets={facets} mobile />
          </Divided>
          <Divided>
            <LengthSection f={f} set={set} mobile />
          </Divided>
          <Divided>
            <TerrainSection f={f} set={set} mobile />
          </Divided>
          <Divided>
            <PopularitySection f={f} set={set} mobile />
          </Divided>
          {PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPage(p.key)}
              className="flex min-h-[52px] items-center gap-2 border-0 border-b border-divider bg-transparent text-left text-ink last:border-b-0"
            >
              <span className="flex-auto font-semibold">{p.label}</span>
              <span className="max-w-[45%] truncate text-[13px] text-muted">{valueOf(p.keys)}</span>
              <ChevronRight className="flex-none text-muted" />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
