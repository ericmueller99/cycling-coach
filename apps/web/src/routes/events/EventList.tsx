import { todayIn } from '@cycling-coach/core';
import type { EventItem, EventSort } from '@cycling-coach/shared';
import { defaultRangeExtractor, useVirtualizer, useWindowVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { dayLabel, SORTS } from '../../lib/events';
import { EventCard, EventRow } from './EventRow';

type Row =
  | { kind: 'header'; key: string; label: string; count?: number | undefined }
  | { kind: 'event'; key: string; e: EventItem; first: boolean; last: boolean }
  | { kind: 'footer'; key: string };

/** Day groups for a start-time sort; one flat group otherwise ("Most popular"). */
function buildRows(items: EventItem[], sort: EventSort, timeZone: string, now: Date, complete: boolean): Row[] {
  const rows: Row[] = [];
  const today = todayIn(timeZone, now);
  const groups: { label: string; items: EventItem[] }[] = [];
  if (sort === 'start') {
    for (const e of items) {
      const label = dayLabel(todayIn(timeZone, new Date(e.start)), today);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(e);
      else groups.push({ label, items: [e] });
    }
  } else if (items.length) {
    groups.push({ label: SORTS.find((s) => s.key === sort)!.group, items });
  }
  groups.forEach((g, gi) => {
    // A day's count is only known once its last event has loaded.
    const known = complete || gi < groups.length - 1;
    rows.push({ kind: 'header', key: `h-${g.label}`, label: g.label, count: known ? g.items.length : undefined });
    g.items.forEach((e, i) => rows.push({ kind: 'event', key: `e-${e.id}`, e, first: i === 0, last: i === g.items.length - 1 }));
  });
  rows.push({ kind: 'footer', key: 'footer' });
  return rows;
}

interface ListProps {
  items: EventItem[];
  sort: EventSort;
  timeZone: string;
  now: Date;
  hasMore: boolean;
  loadMore: () => void;
  /** End-of-list / empty card. */
  footer: ReactNode;
}

function useLoadMore(lastIndex: number | undefined, count: number, hasMore: boolean, loadMore: () => void) {
  useEffect(() => {
    if (hasMore && lastIndex !== undefined && lastIndex >= count - 15) loadMore();
  }, [lastIndex, count, hasMore, loadMore]);
}

/**
 * Desktop list: its own scroll, virtualised (an extended week is ~4,000 events).
 * Day headers stick at the top OUTSIDE the white cards: each group's rows draw the card's edges
 * themselves, and the active header is kept rendered and made sticky.
 */
export function DesktopEventList({ items, sort, timeZone, now, hasMore, loadMore, footer }: ListProps) {
  const rows = useMemo(() => buildRows(items, sort, timeZone, now, !hasMore), [items, sort, timeZone, now, hasMore]);
  const maxSignedUp = useMemo(() => Math.max(1, ...items.map((e) => e.signedUp)), [items]);
  const headers = useMemo(() => rows.flatMap((r, i) => (r.kind === 'header' ? [i] : [])), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = useRef(0);

  const rangeExtractor = useCallback(
    (range: Range) => {
      active.current = [...headers].reverse().find((i) => range.startIndex >= i) ?? headers[0] ?? 0;
      return [...new Set([active.current, ...defaultRangeExtractor(range)])].sort((a, b) => a - b);
    },
    [headers],
  );

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? 44 : rows[i]?.kind === 'footer' ? 120 : 92),
    getItemKey: (i) => rows[i]!.key,
    overscan: 8,
    rangeExtractor,
  });
  const virtual = v.getVirtualItems();
  useLoadMore(virtual[virtual.length - 1]?.index, rows.length, hasMore, loadMore);

  // A new filter or sort starts at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [sort, items[0]?.id]);

  return (
    <div ref={scrollRef} role="region" aria-label="Event list" tabIndex={0} className="min-h-0 flex-auto overflow-y-auto px-6 pb-6">
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {virtual.map((vi) => {
          const row = rows[vi.index]!;
          const sticky = row.kind === 'header' && vi.index === active.current;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={v.measureElement}
              className={sticky ? 'sticky top-0 z-[2]' : 'absolute top-0 left-0 w-full'}
              style={sticky ? undefined : { transform: `translateY(${vi.start}px)` }}
            >
              {row.kind === 'header' ? (
                <div className={`flex items-center justify-between bg-bg px-1 pb-2 ${vi.index === 0 ? 'pt-3.5' : 'pt-[30px]'}`}>
                  <span className="font-semibold">{row.label}</span>
                  {row.count !== undefined && (
                    <span className="text-xs text-muted">
                      {row.count} event{row.count === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              ) : row.kind === 'event' ? (
                <div
                  className={`overflow-hidden border-x border-line ${row.first ? 'rounded-t-[14px] border-t' : ''} ${row.last ? 'rounded-b-[14px] border-b' : 'border-b-0'}`}
                >
                  <div className={row.last ? '' : 'border-b border-divider'}>
                    <EventRow e={row.e} timeZone={timeZone} now={now} maxSignedUp={maxSignedUp} />
                  </div>
                </div>
              ) : (
                <div className="pt-4">{footer}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mobile list (MobileEvents): the page scrolls; virtualised against the window. */
export function MobileEventList({ items, sort, timeZone, now, hasMore, loadMore, footer }: ListProps) {
  const rows = useMemo(() => buildRows(items, sort, timeZone, now, !hasMore), [items, sort, timeZone, now, hasMore]);
  const listRef = useRef<HTMLDivElement>(null);
  const v = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? 32 : rows[i]?.kind === 'footer' ? 140 : 190),
    getItemKey: (i) => rows[i]!.key,
    overscan: 6,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const virtual = v.getVirtualItems();
  useLoadMore(virtual[virtual.length - 1]?.index, rows.length, hasMore, loadMore);

  return (
    <div ref={listRef} className="relative w-full" style={{ height: v.getTotalSize() }}>
      {virtual.map((vi) => {
        const row = rows[vi.index]!;
        return (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={v.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${vi.start - v.options.scrollMargin}px)` }}
          >
            {row.kind === 'header' ? (
              <div className="pt-1.5 pb-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">{row.label}</div>
            ) : row.kind === 'event' ? (
              <div className="pb-2.5">
                <EventCard e={row.e} timeZone={timeZone} />
              </div>
            ) : (
              <div className="pt-1">{footer}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
