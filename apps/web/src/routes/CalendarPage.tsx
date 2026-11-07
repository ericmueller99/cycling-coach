import {
  addDays,
  dayOfMonth,
  daysBetween,
  formatLongDay,
  formatMonthTitle,
  formatShortDate,
  groupByDay,
  monthOf,
  sessionState,
  timeOffOn,
  weekStart,
  weekSummary,
  WEEKDAY_LABELS,
  type CalendarDay,
} from '@cycling-coach/core';
import type { CalendarActivity, CalendarEvent, DayFoodSummary, IsoDate, SessionFeedback, TimeOff } from '@cycling-coach/shared';
import { slotForTime } from '@cycling-coach/core';
import { useNavigate } from '@tanstack/react-router';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, DoneIcon, PlusIcon } from '../components/icons';
import { KcalBar, OVER } from '../components/KcalBar';
import { RpePill } from '../components/RpePill';
import { Button, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { calendarChunkStart, errorMessage, useCalendarRange, useDashboard, useTimeOff } from '../lib/queries';
import { COMPLETED, feedbackForEvent, indexFeedback, type FeedbackIndex } from '../lib/feedback';
import { approx, fmtKcal, includesEstimates, nowTime } from '../lib/food';
import { useDaysRange, useFoodLibrary } from '../lib/foodQueries';
import { SESSION_STYLE, TENTATIVE, durationText, hoursLabel, kindLabel } from '../lib/session';
import { useIsMobile } from '../lib/useIsMobile';
import { useStoredState } from '../lib/useStoredState';
import { DayPanel } from './calendar/DayPanel';
import { MobileDay } from './calendar/MobileDay';
import { ActivityPanel, AddPanel, DetailPanel, syncState, type Selection } from './calendar/panels';
import { ridesMeta, sessionRides } from './calendar/shared';
import { TimeOffChip, TimeOffPanel } from './calendar/time-off';
import { WeekAgenda } from './calendar/WeekAgenda';
import { dayLabel } from './food/dayLabel';
import { useFoodFlows } from './food/flows';


/** A planned session, styled by what became of it. */
function EventChip({
  event,
  rides,
  feedback,
  selected,
  onSelect,
}: {
  event: CalendarEvent;
  /** Its rides — more than one when the athlete grouped them (DECISIONS #32). */
  rides: CalendarActivity[];
  feedback: SessionFeedback | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const s = SESSION_STYLE[event.type];
  const state = sessionState(event);
  const sync = state === 'planned' || state === 'missed' ? syncState(event) : null;
  const look =
    state === 'completed'
      ? { bg: COMPLETED.bg, border: COMPLETED.border, style: 'solid', fg: COMPLETED.fg }
      : state === 'missed'
        ? { bg: '#FFFFFF', border: '#F1B5B0', style: 'dashed', fg: '#B42318' }
        : state === 'skipped'
          ? { bg: '#F3F4F6', border: 'transparent', style: 'solid', fg: '#6B7280' }
          : event.tentative
            ? { bg: 'transparent', border: TENTATIVE.border, style: 'dashed', fg: s.fg }
            : { bg: s.bg, border: 'transparent', style: 'solid', fg: s.fg };
  const plannedMeta = [event.kind !== 'ride' || event.startTime ? kindLabel(event) : '', durationText(event)].filter(Boolean).join(' · ');
  const meta =
    state === 'completed' ? (rides.length ? ridesMeta(rides) : plannedMeta) : state === 'missed' ? `Missed · ${plannedMeta}` : state === 'skipped' ? 'Skipped' : plannedMeta;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1 text-left"
      style={{ background: look.bg, border: `1px ${look.style} ${selected ? '#7DA30A' : look.border}`, opacity: state === 'skipped' ? 0.85 : 1 }}
    >
      <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: look.fg }}>
        {state === 'completed' && <DoneIcon size={13} className="shrink-0" aria-label="Completed" />}
        <span className={`truncate ${state === 'skipped' ? 'line-through' : ''}`}>{event.title}</span>
      </span>
      <span className="flex items-center gap-1 truncate text-[11px] text-muted">
        {sync && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            title={sync === 'synced' ? 'On intervals.icu' : sync === 'failed' ? 'Sync failed — retrying' : 'Not synced yet'}
            style={{ background: sync === 'synced' ? '#15803D' : sync === 'failed' ? '#B42318' : '#9CA3AF' }}
          />
        )}
        <span className="truncate">{meta}</span>
      </span>
      {state === 'completed' && <RpePill feedback={feedback} prompt className="self-start" />}
    </button>
  );
}

/** A ride from intervals.icu that no planned session claimed. */
function ActivityChip({
  activity,
  feedback,
  selected,
  onSelect,
}: {
  activity: CalendarActivity;
  feedback: SessionFeedback | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="flex w-full min-w-0 flex-col gap-0.5 rounded-md bg-surface-2 px-1.5 py-1 text-left"
      style={{ border: `1px solid ${selected ? '#7DA30A' : 'transparent'}` }}
    >
      <span className="flex items-center gap-1 text-xs font-semibold text-ink">
        <DoneIcon size={13} className="shrink-0" aria-label="Ridden" />
        <span className="truncate">{activity.name.replace(/^Zwift - /, '')}</span>
      </span>
      <span className="truncate text-[11px] text-muted">{ridesMeta([activity])}</span>
      <RpePill feedback={feedback} className="self-start" />
    </button>
  );
}

type Month = { year: number; month: number };
type Range = { start: string; weeks: number };

/** Weeks added at either end when a sentinel nears the viewport — a whole number of query chunks. */
const EXTEND_WEEKS = 8;
const GRID_COLUMNS = 'repeat(7, minmax(0, 1fr)) 92px';

/** Grow the range (keeping its chunk alignment) until it holds `week` with room to scroll past it. */
function cover(range: Range, week: string): Range {
  const end = addDays(range.start, range.weeks * 7);
  if (week < range.start) {
    const add = Math.ceil(daysBetween(week, range.start) / 7 / EXTEND_WEEKS) * EXTEND_WEEKS + EXTEND_WEEKS;
    return { start: addDays(range.start, -add * 7), weeks: range.weeks + add };
  }
  if (week >= addDays(end, -EXTEND_WEEKS * 7)) {
    const add = Math.ceil((daysBetween(end, week) / 7 + 1) / EXTEND_WEEKS) * EXTEND_WEEKS + EXTEND_WEEKS;
    return { ...range, weeks: range.weeks + add };
  }
  return range;
}

/** The grid's three layers, remembered on this device. */
export interface Layers {
  training: boolean;
  food: boolean;
  meals: boolean;
}
const LAYERS: { key: keyof Layers; label: string }[] = [
  { key: 'training', label: 'Training' },
  { key: 'food', label: 'Food' },
  { key: 'meals', label: 'Meal detail' },
];

/**
 * Desktop: `week` (a Monday, from `?week=`) is centred on load and the grid scrolls on from there.
 * Phones: the day timeline for today, or the week agenda when `?week=` asks for it.
 */
export function CalendarPage({ week }: { week?: string | undefined }) {
  const dashboard = useDashboard();
  const mobile = useIsMobile();
  const today = dashboard.data?.today;
  if (!today) return <Spinner />;
  if (mobile) return week ? <WeekAgenda today={today} week={week} /> : <MobileDay today={today} date={today} />;
  return <ScrollingCalendar today={today} initialWeek={week ?? weekStart(today)} />;
}

function LayerToggles({ layers, set }: { layers: Layers; set: (l: Layers) => void }) {
  return (
    <div role="group" aria-label="Show on the calendar" className="flex items-center gap-1 rounded-[10px] border border-line-strong bg-surface p-[3px]">
      {LAYERS.map((l) => {
        const on = layers[l.key];
        const disabled = l.key === 'meals' && !layers.food;
        return (
          <button
            key={l.key}
            type="button"
            role="switch"
            aria-checked={on}
            disabled={disabled}
            onClick={() => set({ ...layers, [l.key]: !on })}
            className={`flex min-h-8 items-center gap-1.5 rounded-lg border-0 px-2.5 text-[13px] ${on && !disabled ? 'bg-track font-semibold text-ink' : 'bg-transparent text-muted'}`}
          >
            <span aria-hidden="true" className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${on && !disabled ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface'}`}>
              {on && !disabled && (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              )}
            </span>
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

/** "+ Add ▾": a session, food or time off, for the selected day (else today). */
function AddMenu({ onSession, onFood, onTimeOff }: { onSession: () => void; onFood: () => void; onTimeOff: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const item = 'flex min-h-10 w-full items-center border-0 bg-transparent px-3 text-left text-ink hover:bg-surface-2';
  return (
    <div ref={ref} className="relative">
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <PlusIcon /> Add <ChevronDown />
      </Button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-40 mt-1 w-44 overflow-hidden rounded-[10px] border border-line bg-surface py-1 shadow-[0_8px_24px_rgba(0,0,0,.1)]">
          <button type="button" role="menuitem" className={item} onClick={() => (setOpen(false), onSession())}>
            Session
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => (setOpen(false), onFood())}>
            Food
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => (setOpen(false), onTimeOff())}>
            Time off
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One endless Monday-start week list of training and food. The page is locked to the
 * viewport and the week list scrolls inside it: sentinels above and below grow the range, and the
 * title follows the month at the top of the list.
 */
function ScrollingCalendar({ today, initialWeek }: { today: string; initialWeek: string }) {
  const navigate = useNavigate();
  // Enough weeks above the anchor to centre it on the first load, in chunks the agenda shares.
  const [range, setRange] = useState<Range>(() => ({ start: addDays(calendarChunkStart(today, initialWeek), -8 * 7), weeks: 24 }));
  const [visibleMonth, setVisibleMonth] = useState<Month>(() => monthOf(addDays(initialWeek, 6)));
  const [selected, setSelected] = useState<Selection | { type: 'day'; date: string }>(null);
  const [layers, setLayers] = useStoredState<Layers>('calendar.layers', { training: true, food: true, meals: false });
  const scrollRef = useRef<HTMLElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** The topmost visible week and where it sat, so layout changes above it don't move the view. */
  const anchor = useRef<{ week: string; top: number } | null>(null);
  /** A week to scroll to once it's rendered: today's week centred (on mount, Today). */
  const pendingJump = useRef<{ week: string; align: 'top' | 'center' } | null>({ week: initialWeek, align: 'center' });
  const [jumpTick, setJumpTick] = useState(0);
  /** The last jump; re-applied on every layout change until a wheel, touch, key or pointer event. */
  const pinned = useRef<{ week: string; align: 'top' | 'center' } | null>(null);

  const weeks = useMemo(
    () =>
      Array.from({ length: range.weeks }, (_, i) => {
        const start = addDays(range.start, i * 7);
        return Array.from({ length: 7 }, (_, d) => addDays(start, d));
      }),
    [range],
  );

  const calendar = useCalendarRange(range.start, range.weeks);
  const food = useDaysRange(range.start, range.weeks, layers.food);
  const timeOff = useTimeOff(range.start, addDays(range.start, range.weeks * 7 - 1));
  const { events, activities } = calendar;
  const byDate = useMemo(() => groupByDay(events, activities), [events, activities]);
  const ratings = useMemo(() => indexFeedback(calendar.feedback), [calendar.feedback]);
  const ridesById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  // Food dialogs open over the grid, for the selected day (else today).
  const lib = useFoodLibrary();
  const [foodDate, setFoodDate] = useState<IsoDate>(today);
  const flows = useFoodFlows({ lib: lib.data, date: foodDate, dateLabel: dayLabel(foodDate, today), defaultSlot: 'Breakfast' });
  const addFood = (date: IsoDate, slot?: string) => {
    setFoodDate(date);
    flows.logFood(slot ?? (lib.data ? slotForTime(lib.data.settings.slots, date === today ? nowTime() : '12:00') : 'Breakfast'));
  };

  const weekEl = (week: string) => gridRef.current?.querySelector<HTMLElement>(`[data-week="${week}"]`) ?? null;
  /** Where the visible grid starts: below the sticky weekday labels. */
  const stickyBottom = () => Math.max(labelsRef.current?.getBoundingClientRect().bottom ?? 0, scrollRef.current?.getBoundingClientRect().top ?? 0);

  /** Record the topmost visible week (the scroll anchor) and title the page with its month. */
  const track = useCallback(() => {
    const below = stickyBottom();
    for (const el of gridRef.current?.querySelectorAll<HTMLElement>('[data-week]') ?? []) {
      const rect = el.getBoundingClientRect();
      // A week mostly hidden under the sticky labels isn't the one on show.
      if (rect.bottom <= below + rect.height / 2) continue;
      const week = el.dataset['week']!;
      anchor.current = { week, top: rect.top };
      // A week belongs to the month it ends in — the same rule that puts the month dividers above it.
      const m = monthOf(addDays(week, 6));
      setVisibleMonth((v) => (v.year === m.year && v.month === m.month ? v : m));
      return;
    }
  }, []);

  useEffect(() => {
    const unpin = () => {
      pinned.current = null;
    };
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const e of events) window.addEventListener(e, unpin, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, unpin);
    };
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(track);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [track]);

  /** Put a week centred in the list, or its month divider (else the week) just under the sticky labels. */
  const scrollToWeek = useCallback((week: string, align: 'top' | 'center') => {
    const el = weekEl(week);
    const scroller = scrollRef.current;
    if (!el || !scroller) return false;
    const top = stickyBottom();
    const bottom = scroller.getBoundingClientRect().bottom;
    if (align === 'center') {
      const rect = el.getBoundingClientRect();
      scroller.scrollBy(0, rect.top - (top + (bottom - top - rect.height) / 2));
    } else {
      const divider = el.previousElementSibling instanceof HTMLElement && 'monthDivider' in el.previousElementSibling.dataset ? el.previousElementSibling : null;
      scroller.scrollBy(0, (divider ?? el).getBoundingClientRect().top - top);
    }
    return true;
  }, []);

  // Weeks prepended, or chips loading into rows above the view: hold a fresh jump's target in place
  // (rows above it may still be loading), otherwise keep the topmost week where it was.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) {
        scrollToWeek(pinned.current.week, pinned.current.align);
        track();
        return;
      }
      const a = anchor.current;
      const el = a && weekEl(a.week);
      if (!a || !el) return;
      const delta = el.getBoundingClientRect().top - a.top;
      if (Math.abs(delta) > 0.5) scrollRef.current?.scrollBy(0, delta);
      track();
    });
    ro.observe(grid);
    return () => ro.disconnect();
  }, [track, scrollToWeek]);

  useLayoutEffect(() => {
    const jump = pendingJump.current;
    if (!jump || !scrollToWeek(jump.week, jump.align)) return;
    pendingJump.current = null;
    pinned.current = jump;
    track();
  }, [weeks, jumpTick, track, scrollToWeek]);

  // Re-observed whenever the range changes, so a sentinel still in reach after growing fires again.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (pendingJump.current) return;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === topRef.current) setRange((r) => ({ start: addDays(r.start, -EXTEND_WEEKS * 7), weeks: r.weeks + EXTEND_WEEKS }));
          else setRange((r) => ({ ...r, weeks: r.weeks + EXTEND_WEEKS }));
        }
      },
      { root: scrollRef.current, rootMargin: '800px 0px' },
    );
    if (topRef.current) io.observe(topRef.current);
    if (bottomRef.current) io.observe(bottomRef.current);
    return () => io.disconnect();
  }, [range]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !flows.flow && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flows.flow]);

  const jumpTo = (week: string, align: 'top' | 'center' = 'top') => {
    pendingJump.current = { week, align };
    setRange((r) => cover(r, week));
    setJumpTick((t) => t + 1);
  };
  const stepWeek = (n: number) => {
    const current = anchor.current?.week ?? initialWeek;
    jumpTo(addDays(current, n * 7));
  };

  const selectedEvent = selected?.type === 'event' ? events.find((e) => e.id === selected.id) : undefined;
  const selectedActivity = selected?.type === 'activity' ? activities.find((a) => a.id === selected.id) : undefined;
  const focusDate = selected?.type === 'day' || selected?.type === 'add' || selected?.type === 'time-off-add' ? selected.date : today;

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <PageHeader title={formatMonthTitle(visibleMonth.year, visibleMonth.month)}>
        <LayerToggles layers={layers} set={setLayers} />
        <div className="flex">
          <button type="button" aria-label="Previous week" onClick={() => stepWeek(-1)} className="flex h-10 w-9 items-center justify-center rounded-l-[10px] border border-line-strong bg-surface">
            <ChevronDown className="rotate-180" />
          </button>
          <button type="button" aria-label="Next week" onClick={() => stepWeek(1)} className="-ml-px flex h-10 w-9 items-center justify-center rounded-r-[10px] border border-line-strong bg-surface">
            <ChevronDown />
          </button>
        </div>
        <Button variant="ghost" onClick={() => jumpTo(weekStart(today), 'center')}>
          Today
        </Button>
        <AddMenu onSession={() => setSelected({ type: 'add', date: focusDate })} onFood={() => addFood(focusDate)} onTimeOff={() => setSelected({ type: 'time-off-add', date: focusDate })} />
        <Button variant="primary" onClick={() => void navigate({ to: '/', search: { new: true, prompt: 'Plan next week' } })}>
          Ask coach to plan
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <section ref={scrollRef} aria-label="Calendar grid" className="box-border min-w-0 flex-1 overflow-y-auto px-6 pb-7 [overflow-anchor:none]">
          <div ref={labelsRef} className="sticky top-0 z-10 grid gap-1.5 bg-bg pt-4 pb-1.5" style={{ gridTemplateColumns: GRID_COLUMNS }}>
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="px-1 text-xs font-semibold text-muted uppercase">
                {d}
              </div>
            ))}
            <div className="px-1 text-xs font-semibold text-muted uppercase">Week</div>
          </div>
          {calendar.error && <ErrorNote>{errorMessage(calendar.error)}</ErrorNote>}
          <div ref={topRef} />
          <div ref={gridRef} className="grid gap-1.5" style={{ gridTemplateColumns: GRID_COLUMNS }}>
            {weeks.map((week) => {
              const first = week.find((d) => dayOfMonth(d) === 1);
              const m = first && monthOf(first);
              return (
                <Fragment key={week[0]}>
                  {m && (
                    <div data-month-divider="" className="col-span-full flex items-center gap-3 px-1 pt-4 pb-0.5">
                      <span className="text-sm font-bold text-ink">{formatMonthTitle(m.year, m.month)}</span>
                      <span className="h-px grow bg-line" />
                    </div>
                  )}
                  <WeekRow
                    week={week}
                    today={today}
                    byDate={byDate}
                    timeOff={timeOff}
                    food={layers.food ? food.days : undefined}
                    trendKg={food.weeks.get(week[0]!)}
                    layers={layers}
                    ratings={ratings}
                    ridesById={ridesById}
                    selected={selected}
                    onSelect={setSelected}
                  />
                </Fragment>
              );
            })}
          </div>
          <div ref={bottomRef} />
          <div className="pt-3 text-center text-xs text-muted">Keeps loading as you scroll</div>
        </section>
        {selected?.type === 'day' && (
          <DayPanel
            key={selected.date}
            date={selected.date}
            today={today}
            trendKg={food.weeks.get(weekStart(selected.date))}
            day={byDate.get(selected.date)}
            timeOff={timeOffOn(timeOff, selected.date)}
            ridesById={ridesById}
            ratings={ratings}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
            onFood={(slot) => addFood(selected.date, slot)}
            onEntry={(entry) => flows.setFlow({ kind: 'entry', entry })}
          />
        )}
        {selectedEvent && (
          <DetailPanel
            key={selectedEvent.id}
            event={selectedEvent}
            rides={sessionRides(selectedEvent, ridesById)}
            dayRides={byDate.get(selectedEvent.date)?.rides ?? []}
            feedback={feedbackForEvent(ratings, selectedEvent)}
            onClose={() => setSelected(null)}
          />
        )}
        {selectedActivity && (
          <ActivityPanel
            key={selectedActivity.id}
            activity={selectedActivity}
            feedback={ratings.byActivity.get(selectedActivity.id)}
            sessions={byDate.get(selectedActivity.startLocal.slice(0, 10))?.events ?? []}
            onAdded={(id) => setSelected({ type: 'event', id })}
            onClose={() => setSelected(null)}
          />
        )}
        {selected?.type === 'add' && <AddPanel date={selected.date} onClose={() => setSelected(null)} onAdded={(id) => setSelected({ type: 'event', id })} />}
        {selected?.type === 'time-off-add' && <TimeOffPanel key={selected.date} date={selected.date} today={today} onClose={() => setSelected(null)} />}
        {selected?.type === 'time-off' && <TimeOffPanel key={selected.entry.id} entry={selected.entry} today={today} onClose={() => setSelected(null)} />}
      </div>
      {flows.element}
    </div>
  );
}

/** Eaten vs budget fill (PlanWeek): today accent, within 200 under green, further under orange. */
function fillColor(net: number, isToday: boolean) {
  if (isToday) return '#3F6212';
  return net >= -200 ? '#15803D' : '#F5782A';
}
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtKcal(Math.abs(n))}`;

/** A day cell's food footer: eaten / budget bar and net; future days the budget. */
function FoodFooter({ d, date, today }: { d: DayFoodSummary | undefined; date: string; today: string }) {
  if (!d) return null;
  const isToday = date === today;
  if (date > today) {
    return d.budget != null ? <div className="mt-auto border-t border-divider px-0.5 pt-1 font-mono text-[11px] text-muted">≈ {fmtKcal(d.budget)} budget</div> : null;
  }
  const eaten = d.eaten?.kcal;
  if (eaten == null && !isToday) return null;
  const kcal = eaten ?? 0;
  const est = approx(d.estimates);
  if (d.budget == null) return <div className="mt-auto border-t border-divider px-0.5 pt-1 font-mono text-[11px] text-muted">{est}{fmtKcal(kcal)} kcal</div>;
  const net = kcal - d.budget;
  const fill = fillColor(net, isToday);
  const color = net > 0 ? OVER : fill;
  return (
    <div className="mt-auto flex flex-col gap-1 border-t border-divider px-0.5 pt-1" title={`${est}${fmtKcal(kcal)} eaten of ${fmtKcal(d.budget)} budget${d.estimates ? `. ${includesEstimates(d.estimates)}` : ''}`}>
      <KcalBar eaten={kcal} budget={d.budget} fill={fill} />
      <div className="flex justify-between gap-1 font-mono text-[11px] leading-tight">
        <span className="truncate text-muted">{d.estimates ? `${est}${fmtKcal(kcal)} est.` : `${fmtKcal(kcal)} / ${fmtKcal(d.budget)}`}</span>
        <span className="flex-none font-semibold" style={{ color }}>
          {isToday && net <= 0 ? `${fmtKcal(-net)} left` : signed(net)}
        </span>
      </div>
    </div>
  );
}

function WeekRow({
  week,
  today,
  byDate,
  timeOff,
  food,
  trendKg,
  layers,
  ratings,
  ridesById,
  selected,
  onSelect,
}: {
  week: string[];
  today: string;
  byDate: Map<string, CalendarDay>;
  timeOff: readonly TimeOff[];
  /** The food layer, when it's on. */
  food: Map<string, DayFoodSummary> | undefined;
  trendKg: number | null | undefined;
  layers: Layers;
  ratings: FeedbackIndex;
  ridesById: Map<string, CalendarActivity>;
  selected: Selection | { type: 'day'; date: string };
  onSelect: (s: Selection | { type: 'day'; date: string }) => void;
}) {
  const { minutes } = weekSummary(week, today, byDate);
  // Average net kcal/day over the week's full past days with food logged and a budget.
  const nets = food ? week.filter((d) => d < today).flatMap((d) => (food.get(d)?.eaten && food.get(d)?.budget != null ? [food.get(d)!.eaten!.kcal - food.get(d)!.budget!] : [])) : [];
  const avgNet = nets.length ? Math.round(nets.reduce((a, b) => a + b, 0) / nets.length) : undefined;
  return (
    <>
      {week.map((date, i) => {
        const isToday = date === today;
        const day = byDate.get(date);
        const f = food?.get(date);
        const dom = dayOfMonth(date);
        const picked = (selected?.type === 'add' || selected?.type === 'day') && selected.date === date;
        const edge = picked ? '#15181E' : isToday ? '#7DA30A' : '#E3E6EB';
        // Days 1–7 carry a heavier top edge (and the 1st a left one), tracing where the month starts.
        const monthEdge = '#C9CED6';
        return (
          <div
            key={date}
            data-week={i === 0 ? date : undefined}
            role="button"
            tabIndex={0}
            aria-pressed={picked}
            aria-label={formatLongDay(date)}
            onClick={() => onSelect({ type: 'day', date })}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onSelect({ type: 'day', date }))}
            className="group flex min-h-28 min-w-0 cursor-pointer flex-col gap-1 rounded-[10px] p-1.5"
            style={{
              background: isToday ? '#F9FCEF' : '#FFFFFF',
              border: `${picked ? 2 : 1}px solid ${edge}`,
              ...(dom <= 7 && !isToday && !picked ? { borderTop: `2px solid ${monthEdge}` } : {}),
              ...(dom === 1 && i > 0 && !isToday && !picked ? { borderLeft: `2px solid ${monthEdge}` } : {}),
            }}
          >
            <div className="flex items-center justify-between gap-1 px-0.5">
              <span className="font-mono text-xs font-semibold text-ink">{dom === 1 ? formatShortDate(date) : dom}</span>
              <span className="flex items-center gap-1">
                {isToday && <span className="text-[10px] font-semibold text-accent-ink">Today</span>}
                <button
                  type="button"
                  aria-label={`Add session on ${formatLongDay(date)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ type: 'add', date });
                  }}
                  className={`flex h-5 w-5 items-center justify-center rounded border-0 bg-hover p-0 text-muted group-hover:opacity-100 focus-visible:opacity-100 ${selected?.type === 'add' && selected.date === date ? 'opacity-100' : 'opacity-0'}`}
                >
                  <PlusIcon size={12} />
                </button>
              </span>
            </div>
            {layers.training &&
              timeOffOn(timeOff, date).map((t) => (
                <TimeOffChip key={t.id} entry={t} date={date} firstInWeek={i === 0} lastInWeek={i === week.length - 1} onOpen={() => onSelect({ type: 'time-off', entry: t })} />
              ))}
            {layers.training &&
              day?.events.map((e) => (
                <EventChip
                  key={e.id}
                  event={e}
                  rides={sessionRides(e, ridesById)}
                  feedback={feedbackForEvent(ratings, e)}
                  selected={selected?.type === 'event' && selected.id === e.id}
                  onSelect={() => onSelect({ type: 'event', id: e.id })}
                />
              ))}
            {layers.training &&
              day?.rides.map((a) => (
                <ActivityChip
                  key={a.id}
                  activity={a}
                  feedback={ratings.byActivity.get(a.id)}
                  selected={selected?.type === 'activity' && selected.id === a.id}
                  onSelect={() => onSelect({ type: 'activity', id: a.id })}
                />
              ))}
            {food && layers.meals && f && f.slots.length > 0 && (
              <div className="mt-auto flex flex-col px-0.5 text-[11px] leading-tight">
                {f.slots.map((sl) => (
                  <div key={sl.name} className="flex justify-between gap-1 text-muted">
                    <span className="truncate">{sl.name}</span>
                    <span className="font-mono">{fmtKcal(sl.kcal)}</span>
                  </div>
                ))}
              </div>
            )}
            {food && <FoodFooter d={f} date={date} today={today} />}
          </div>
        );
      })}
      <div className="flex flex-col items-end gap-0.5 px-1 pt-1.5 text-right font-mono text-xs">
        <span className="font-semibold text-ink">{hoursLabel(minutes)}</span>
        {food && avgNet !== undefined && (
          <span className={avgNet > 0 ? 'font-semibold text-danger' : avgNet < -150 ? 'text-[#B54708]' : 'text-muted'} title="Average net kcal per day (eaten − budget) over this week's past days">
            net {signed(avgNet)}/d
          </span>
        )}
        {food && trendKg != null && <span className="text-muted">{trendKg.toFixed(1)} kg</span>}
      </div>
    </>
  );
}
