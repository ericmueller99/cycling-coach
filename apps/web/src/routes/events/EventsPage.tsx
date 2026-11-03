import { z2Wkg } from '@cycling-coach/core';
import type { EventFilters, EventQueryResult, EventSort, EventsStatus } from '@cycling-coach/shared';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppBar, IconButton } from '../../components/AppBar';
import { ChatIcon, FiltersIcon, SearchIcon, XIcon } from '../../components/icons';
import { ErrorNote } from '../../components/ui';
import { activeChips, countActive, filtersPrompt, SORTS, whenLabel, withFilter, type EventsSearch } from '../../lib/events';
import { errorMessage, useEvents, useEventsStatus, useProfile } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import type { SetFilters } from './controls';
import { DesktopEventList, MobileEventList } from './EventList';
import { useDebouncedSearch, FilterRail } from './FilterRail';
import { FiltersSheet } from './FiltersSheet';
import { GetMoreButton, StatusLine } from './StatusLine';

/** Relative times ("in 25 min") stay current. */
function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function EndCard({ status, timeZone, now, empty }: { status: EventsStatus | undefined; timeZone: string; now: Date; empty: boolean }) {
  const through = status?.through ? whenLabel(status.through, timeZone, now) : undefined;
  const extended = status?.source === 'extended';
  return (
    <div className="flex flex-col gap-4">
      {empty && (
        <div className="rounded-[14px] border border-dashed border-[#C5CBD4] p-8 text-center text-muted">
          No events match. Loosen a filter{status?.extended && !extended ? ', or get more events beyond the next day' : ''}.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3.5 rounded-[14px] border border-dashed border-[#C5CBD4] bg-surface p-4">
        <div className="flex-[1_1_280px]">
          <div className="font-semibold">
            That's the end of the {extended ? 'extended' : 'public'} feed{through ? ` (through ${through})` : ''}
          </div>
          <div className="text-[13px] text-muted">
            {status?.extended
              ? 'Get more events loads about the next 7 days using your Zwift login. It runs once and is cached; nothing is posted to Zwift.'
              : 'The public feed covers about the next day and refreshes every hour.'}
          </div>
        </div>
        <GetMoreButton status={status} timeZone={timeZone} now={now} size="lg" />
      </div>
    </div>
  );
}

/** "N of M events" + removable filter chips + sort. */
function ResultsToolbar({ f, set, sort, setSort, result }: { f: EventFilters; set: SetFilters; sort: EventSort; setSort: (s: EventSort) => void; result: EventQueryResult | undefined }) {
  const chips = activeChips(f);
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-bg px-6 pt-3.5 pb-3">
      <div className="mr-1 font-semibold">{result ? `${result.total.toLocaleString('en-US')} of ${result.all.toLocaleString('en-US')} events` : 'Loading…'}</div>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => set(c.clear(f))}
          aria-label={`Remove filter ${c.label}`}
          className="flex min-h-[30px] items-center gap-1.5 rounded-full border-0 bg-[#E4F5B5] pr-2 pl-2.5 text-xs font-semibold text-[#2F4A0D]"
        >
          {c.label}
          <XIcon size={12} strokeWidth={3} />
        </button>
      ))}
      <div className="grow" />
      <label htmlFor="ev-sort" className="text-[13px] text-muted">
        Sort
      </label>
      <select id="ev-sort" value={sort} onChange={(e) => setSort(e.target.value as EventSort)} className="min-h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
        {SORTS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const QUICK: { key: string; label: string; on: (f: EventFilters) => boolean; flip: (f: EventFilters) => EventFilters }[] = [
  { key: 'today', label: 'Today', on: (f) => f.day === 'today', flip: (f) => ({ ...f, day: f.day === 'today' ? 'all' : 'today' }) },
  { key: 'races', label: 'Races', on: (f) => f.types.length === 1 && f.types[0] === 'race', flip: (f) => ({ ...f, types: f.types.length === 1 && f.types[0] === 'race' ? [] : ['race'] }) },
  { key: 'enter', label: 'I can enter', on: (f) => f.canEnter, flip: (f) => ({ ...f, canEnter: !f.canEnter }) },
  { key: 'z2', label: 'Fits Z2', on: (f) => f.fitsZ2, flip: (f) => ({ ...f, fitsZ2: !f.fitsZ2 }) },
  {
    key: 'long',
    label: '60+ km',
    on: (f) => f.lengthUnit === 'km' && f.lengthMin === 60 && f.lengthMax === undefined,
    flip: (f) =>
      f.lengthUnit === 'km' && f.lengthMin === 60 && f.lengthMax === undefined
        ? withFilter(f, 'lengthMin', undefined)
        : withFilter({ ...f, lengthUnit: 'km', lengthMin: 60 }, 'lengthMax', undefined),
  },
  { key: 'unlock', label: 'Has an unlock', on: (f) => f.hasUnlock, flip: (f) => ({ ...f, hasUnlock: !f.hasUnlock }) },
];

/**
 * Zwift events. Everything shown comes from our own database; the only buttons that
 * reach Zwift are Refresh (public feed, at most every 15 min) and Get more events (logged-in, at
 * most every 6 h). Filters live in the URL.
 */
export function EventsPage({ search }: { search: EventsSearch }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const now = useNow();
  const { sort, ...filters } = search;
  const f = filters as EventFilters;

  const go = useCallback(
    (next: EventsSearch) => void navigate({ to: '/events', search: next, replace: true }),
    [navigate],
  );
  const set: SetFilters = useCallback((next) => go({ ...next, sort }), [go, sort]);
  const setSort = (s: EventSort) => go({ ...f, sort: s });

  const profile = useProfile();
  const p = profile.data?.profile;
  const timeZone = p?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const z2 = useMemo(() => {
    if (!p) return undefined;
    const [lo, hi] = z2Wkg({ ftp: p.ftpZwift, weightKg: p.weightKg, zwiftWeightKg: p.zwiftWeightKg });
    return `${lo.toFixed(2)}–${hi.toFixed(2)}`;
  }, [p]);

  const status = useEventsStatus();
  const events = useEvents(useMemo(() => ({ filters: f, sort }), [JSON.stringify(f), sort]));
  const items = useMemo(() => events.data?.pages.flatMap((pg) => pg.items) ?? [], [events.data]);
  const first = events.data?.pages[0];
  const loadMore = useCallback(() => {
    if (!events.isFetchingNextPage) void events.fetchNextPage();
  }, [events]);

  const askCoach = () => void navigate({ to: '/', search: { new: true, prompt: filtersPrompt(f) } });
  const listProps = {
    items,
    sort,
    timeZone,
    now,
    hasMore: Boolean(events.hasNextPage),
    loadMore,
    footer: <EndCard status={status.data} timeZone={timeZone} now={now} empty={Boolean(first && first.total === 0)} />,
  };

  if (isMobile) return <MobileEvents f={f} set={set} sort={sort} setSort={setSort} status={status.data} result={first} timeZone={timeZone} now={now} z2={z2} listProps={listProps} error={events.error} />;

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-line bg-bg px-7 py-[18px]">
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-bold">Zwift Events</h1>
          <StatusLine status={status.data} timeZone={timeZone} now={now} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={askCoach} className="flex min-h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3.5 font-medium text-ink">
            <ChatIcon size={16} className="text-accent-ink" />
            Ask coach about these
          </button>
          <GetMoreButton status={status.data} timeZone={timeZone} now={now} />
        </div>
      </header>
      <div className="flex min-h-0 flex-auto">
        <FilterRail f={f} set={set} facets={first?.facets} z2={z2} />
        <section aria-label="Results" className="flex min-h-0 min-w-0 flex-auto flex-col">
          <ResultsToolbar f={f} set={set} sort={sort} setSort={setSort} result={first} />
          {events.error && (
            <div className="px-6 pt-4">
              <ErrorNote>{errorMessage(events.error)}</ErrorNote>
            </div>
          )}
          <DesktopEventList {...listProps} />
        </section>
      </div>
    </div>
  );
}

function MobileEvents({
  f,
  set,
  sort,
  setSort,
  status,
  result,
  timeZone,
  now,
  z2,
  listProps,
  error,
}: {
  f: EventFilters;
  set: SetFilters;
  sort: EventSort;
  setSort: (s: EventSort) => void;
  status: EventsStatus | undefined;
  result: EventQueryResult | undefined;
  timeZone: string;
  now: Date;
  z2: string | undefined;
  listProps: Parameters<typeof MobileEventList>[0];
  error: unknown;
}) {
  const [sheet, setSheet] = useState(false);
  const [searching, setSearching] = useState(Boolean(f.q));
  const [q, setQ] = useDebouncedSearch(f, set);
  const n = countActive(f);
  return (
    <>
      <AppBar
        title="Zwift Events"
        actions={
          <IconButton aria-label={searching ? 'Close search' : 'Search events'} onClick={() => (searching && f.q ? set({ ...f, q: '' }) : null, setSearching(!searching))}>
            {searching ? <XIcon size={20} /> : <SearchIcon size={20} />}
          </IconButton>
        }
      >
        <div className="flex flex-col gap-2 border-b border-line bg-surface px-4 pb-2.5">
          {searching && (
            <input
              autoFocus
              type="search"
              aria-label="Search events"
              placeholder="Name, route, organiser, series"
              value={q}
              maxLength={100}
              onChange={(e) => setQ(e.target.value)}
              className="min-h-[44px] rounded-[10px] border border-line-strong bg-surface px-3 text-base text-ink"
            />
          )}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-auto">
              <StatusLine status={status} timeZone={timeZone} now={now} compact />
            </div>
            <GetMoreButton status={status} timeZone={timeZone} now={now} size="sm" />
          </div>
          <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
            <button type="button" onClick={() => setSheet(true)} className="flex min-h-9 flex-none items-center gap-1.5 rounded-full border-0 bg-ink px-3 text-[13px] font-semibold text-white">
              <FiltersIcon />
              Filters{n ? ` · ${n}` : ''}
            </button>
            {QUICK.map((c) => {
              const on = c.on(f);
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set(c.flip(f))}
                  className={`min-h-9 flex-none rounded-full border px-3 text-[13px] ${on ? 'border-accent-ring bg-[#E4F5B5] font-semibold text-[#2F4A0D]' : 'border-line-strong bg-surface text-ink'}`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </AppBar>
      <div className="flex flex-col px-4 pt-3 pb-5">
        <div className="flex items-center justify-between pb-2.5">
          <span className="text-[13px] font-semibold">{result ? `${result.total.toLocaleString('en-US')} events` : 'Loading…'}</span>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as EventSort)} className="min-h-[36px] rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {error ? <ErrorNote>{errorMessage(error)}</ErrorNote> : null}
        <MobileEventList {...listProps} />
      </div>
      {sheet && <FiltersSheet f={f} set={set} facets={result?.facets} total={result?.total} z2={z2} onClose={() => setSheet(false)} />}
    </>
  );
}
