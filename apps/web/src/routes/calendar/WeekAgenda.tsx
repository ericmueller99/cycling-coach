import {
  addDays,
  dayOfMonth,
  formatLongDay,
  formatMonthTitle,
  formatRange,
  groupByDay,
  monthOf,
  sessionState,
  timeOffOn,
  weekDates,
  weekStart,
  weekSummary,
  WEEKDAY_LABELS,
} from '@cycling-coach/core';
import type { CalendarActivity, CalendarEvent, SessionFeedback } from '@cycling-coach/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { AppBar, IconButton } from '../../components/AppBar';
import { ChevronDown, ChevronLeft, ChevronRight, DoneIcon, PlusIcon } from '../../components/icons';
import { KcalBar } from '../../components/KcalBar';
import { RpePill } from '../../components/RpePill';
import { Sheet } from '../../components/Sheet';
import { ErrorNote, Spinner } from '../../components/ui';
import { useDaysRange } from '../../lib/foodQueries';
import { calendarChunkStart, errorMessage, useCalendarRange, useTimeOff } from '../../lib/queries';
import { COMPLETED, feedbackForEvent, indexFeedback } from '../../lib/feedback';
import { SESSION_STYLE, TENTATIVE, TIME_OFF_STYLE, durationText } from '../../lib/session';
import { ActivityPanel, AddPanel, DetailPanel, type Selection } from './panels';
import { ridesMeta, sessionRides } from './shared';
import { TimeOffCard, TimeOffPanel } from './time-off';

/** A day's eaten vs budget on the week strip; the overage in red. */
function FoodBar({ eaten, budget }: { eaten: number | undefined; budget: number | null | undefined }) {
  return <KcalBar eaten={eaten && budget ? eaten : 0} budget={budget ?? 1} className="h-1 w-[26px] rounded-sm" />;
}

/** Unplanned rides on the strip and the agenda. */
const RIDE_COLOR = '#A3AAB6';

const dayId = (date: string) => `agenda-${date}`;

/**
 * The phone calendar: exactly one week, paged by the chevrons, a
 * swipe or the month picker, with the week in the URL so back/forward work. No infinite scroll —
 * that's what trapped the nav on phones.
 */
export function WeekAgenda({ today, week }: { today: string; week: string }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Selection>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  /** A day to scroll to once the week is on screen (Today). */
  const scrollTarget = useRef<string | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const dates = useMemo(() => weekDates(week), [week]);
  const calendar = useCalendarRange(calendarChunkStart(today, week), 4);
  const food = useDaysRange(calendarChunkStart(today, week), 4);
  const timeOff = useTimeOff(week, addDays(week, 6));
  const { events, activities } = calendar;
  const byDay = useMemo(() => groupByDay(events, activities), [events, activities]);
  const ridesById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const ratings = useMemo(() => indexFeedback(calendar.feedback), [calendar.feedback]);
  const summary = weekSummary(dates, today, byDay);
  const holdsToday = dates.includes(today);

  const goWeek = (w: string) => void navigate({ to: '/calendar', search: { week: w } });

  const scrollToDay = (date: string) => {
    const el = document.getElementById(dayId(date));
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (headerRef.current?.offsetHeight ?? 0) - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  // A new week starts at its top, unless Today asked for today's block.
  useEffect(() => {
    setSelected(null);
    const target = scrollTarget.current;
    scrollTarget.current = null;
    if (target) requestAnimationFrame(() => scrollToDay(target));
    else window.scrollTo(0, 0);
  }, [week]);

  const goToday = () => {
    if (holdsToday) return scrollToDay(today);
    scrollTarget.current = today;
    goWeek(weekStart(today));
  };

  // Swipes from inside a sheet bubble here through the portal; only the page itself pages weeks.
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    swipe.current = t && e.currentTarget.contains(e.target as Node) ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = swipe.current;
    const t = e.changedTouches[0];
    swipe.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) goWeek(addDays(week, dx < 0 ? 7 : -7));
  };

  const selectedEvent = selected?.type === 'event' ? events.find((e) => e.id === selected.id) : undefined;
  const selectedActivity = selected?.type === 'activity' ? activities.find((a) => a.id === selected.id) : undefined;
  const summaryText = [summary.minutes ? `~${(summary.minutes / 60).toFixed(1)} h` : '', `${summary.done} done`, `${summary.planned} planned`]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex grow flex-col" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <AppBar
        ref={headerRef}
        title="Calendar"
        border={false}
        actions={
          <>
            <button type="button" onClick={goToday} className="min-h-[36px] rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink">
              Today
            </button>
            <IconButton aria-label="Add" onClick={() => setAdding(true)}>
              <PlusIcon size={20} />
            </IconButton>
            <Link
              to="/calendar/$date"
              params={{ date: holdsToday ? today : week }}
              className="flex min-h-[36px] items-center rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink no-underline hover:text-ink"
            >
              Day
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-2.5 border-b border-line px-2 pt-1 pb-3">
          <div className="flex items-center gap-1">
            <IconButton aria-label="Previous week" onClick={() => goWeek(addDays(week, -7))}>
              <ChevronLeft size={18} strokeWidth={2.2} />
            </IconButton>
            <button
              type="button"
              aria-label={`${formatRange(week, addDays(week, 6))}, pick a month`}
              onClick={() => setPicking(true)}
              className="flex min-h-[44px] flex-auto flex-col items-center justify-center border-0 bg-transparent leading-tight text-ink"
            >
              <span className="flex items-center gap-1 font-semibold">
                {formatRange(week, addDays(week, 6))}
                <ChevronDown strokeWidth={2.2} />
              </span>
              <span className="font-mono text-[11px] text-muted">{calendar.pending ? ' ' : summaryText}</span>
            </button>
            <IconButton aria-label="Next week" onClick={() => goWeek(addDays(week, 7))}>
              <ChevronRight size={18} strokeWidth={2.2} />
            </IconButton>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {dates.map((date, i) => {
              const day = byDay.get(date);
              const sessionDots = [...(day?.events.map((e) => SESSION_STYLE[e.type].dot) ?? []), ...(day?.rides.map(() => RIDE_COLOR) ?? [])];
              const dots = [...timeOffOn(timeOff, date).map((t) => TIME_OFF_STYLE[t.kind].dot), ...sessionDots].slice(0, 3);
              const isToday = date === today;
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={`${formatLongDay(date)}${sessionDots.length ? `, ${sessionDots.length} session${sessionDots.length > 1 ? 's' : ''}` : ''}`}
                  onClick={() => scrollToDay(date)}
                  className="flex min-h-[64px] flex-col items-center gap-0.5 rounded-xl py-1.5 text-ink"
                  style={{ background: isToday ? '#F4FADF' : '#FFFFFF', border: `1.5px solid ${isToday ? '#7DA30A' : '#EDEFF2'}` }}
                >
                  <span className="text-[11px] text-muted">{WEEKDAY_LABELS[i]}</span>
                  <span className="font-mono text-[15px] font-semibold">{dayOfMonth(date)}</span>
                  <span className="flex h-[6px] gap-[3px]">
                    {dots.map((c, j) => (
                      <span key={j} className="h-[6px] w-[6px] rounded-full" style={{ background: c }} />
                    ))}
                  </span>
                  <FoodBar eaten={food.days.get(date)?.eaten?.kcal} budget={food.days.get(date)?.budget} />
                </button>
              );
            })}
          </div>
        </div>
      </AppBar>

      <section aria-label="Week agenda" className="flex flex-col gap-1 px-4 pt-2 pb-5">
        {calendar.error && <ErrorNote>{errorMessage(calendar.error)}</ErrorNote>}
        {calendar.pending ? (
          <Spinner />
        ) : (
          dates.map((date) => {
            const day = byDay.get(date);
            const off = timeOffOn(timeOff, date);
            const empty = !day?.events.length && !day?.rides.length && !off.length;
            return (
              <div key={date} id={dayId(date)} className="flex flex-col gap-2 pt-2.5 pb-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{formatLongDay(date)}</span>
                  {date === today && <span className="text-xs font-semibold text-accent-ink">Today</span>}
                </div>
                {off.map((t) => (
                  <TimeOffCard key={t.id} entry={t} onOpen={() => setSelected({ type: 'time-off', entry: t })} />
                ))}
                {day?.events.map((e) => (
                  <SessionCard
                    key={e.id}
                    event={e}
                    rides={sessionRides(e, ridesById)}
                    feedback={feedbackForEvent(ratings, e)}
                    onOpen={() => setSelected({ type: 'event', id: e.id })}
                  />
                ))}
                {day?.rides.map((a) => (
                  <RideCard key={a.id} activity={a} feedback={ratings.byActivity.get(a.id)} onOpen={() => setSelected({ type: 'activity', id: a.id })} />
                ))}
                {empty && (
                  <button
                    type="button"
                    onClick={() => setSelected({ type: 'add', date })}
                    className="min-h-[48px] rounded-xl border border-dashed border-[#C5CBD4] bg-transparent text-[13px] text-muted"
                  >
                    Rest day · + Add session
                  </button>
                )}
              </div>
            );
          })
        )}
        <div className="flex gap-2 pt-3">
          <button
            type="button"
            onClick={() => void navigate({ to: '/', search: { new: true, prompt: 'Plan next week' } })}
            className="min-h-[48px] flex-1 rounded-xl border-0 bg-accent font-semibold text-on-accent"
          >
            Ask coach to plan
          </button>
          <button type="button" onClick={() => goWeek(addDays(week, 7))} className="min-h-[48px] flex-1 rounded-xl border border-line-strong bg-surface font-medium text-ink">
            Next week →
          </button>
        </div>
      </section>

      {selectedEvent && (
        <DetailPanel
          sheet
          key={selectedEvent.id}
          event={selectedEvent}
          rides={sessionRides(selectedEvent, ridesById)}
          dayRides={byDay.get(selectedEvent.date)?.rides ?? []}
          feedback={feedbackForEvent(ratings, selectedEvent)}
          onClose={() => setSelected(null)}
        />
      )}
      {selectedActivity && (
        <ActivityPanel
          sheet
          key={selectedActivity.id}
          activity={selectedActivity}
          feedback={ratings.byActivity.get(selectedActivity.id)}
          sessions={byDay.get(selectedActivity.startLocal.slice(0, 10))?.events ?? []}
          onAdded={(id) => setSelected({ type: 'event', id })}
          onClose={() => setSelected(null)}
        />
      )}
      {selected?.type === 'add' && (
        <AddPanel sheet date={selected.date} onClose={() => setSelected(null)} onAdded={(id) => setSelected({ type: 'event', id })} />
      )}
      {selected?.type === 'time-off-add' && <TimeOffPanel sheet date={selected.date} today={today} onClose={() => setSelected(null)} />}
      {selected?.type === 'time-off' && <TimeOffPanel sheet key={selected.entry.id} entry={selected.entry} today={today} onClose={() => setSelected(null)} />}
      {adding && (
        <Sheet title="Add" onClose={() => setAdding(false)}>
          <div className="flex flex-col gap-2">
            {(['add', 'time-off-add'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setAdding(false);
                  setSelected({ type, date: holdsToday ? today : week });
                }}
                className="min-h-[48px] rounded-xl border border-line-strong bg-surface font-medium text-ink"
              >
                {type === 'add' ? 'Session' : 'Time off'}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {picking && (
        <MonthPicker
          shown={monthOf(addDays(week, 6))}
          today={today}
          onClose={() => setPicking(false)}
          onPick={(w) => {
            setPicking(false);
            goWeek(w);
          }}
        />
      )}
    </div>
  );
}

function SessionCard({
  event,
  rides,
  feedback,
  onOpen,
}: {
  event: CalendarEvent;
  rides: CalendarActivity[];
  feedback: SessionFeedback | undefined;
  onOpen: () => void;
}) {
  const s = SESSION_STYLE[event.type];
  const state = sessionState(event);
  const meta = [
    state === 'missed' ? 'Missed' : state === 'skipped' ? 'Skipped' : '',
    s.label,
    state === 'completed' && rides.length ? ridesMeta(rides) : durationText(event),
    state === 'completed' ? '' : event.meta,
  ]
    .filter(Boolean)
    .join(' · ');
  const border =
    state === 'completed'
      ? `1px solid ${COMPLETED.border}`
      : state === 'missed'
        ? '1px dashed #F1B5B0'
        : `1px ${event.tentative ? 'dashed' : 'solid'} ${event.tentative ? TENTATIVE.border : '#E3E6EB'}`;
  const bg = state === 'completed' ? COMPLETED.bg : state === 'skipped' ? '#F3F4F6' : '#FFFFFF';
  const fg = state === 'completed' ? COMPLETED.fg : state === 'missed' ? '#B42318' : state === 'skipped' ? '#6B7280' : undefined;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[64px] items-center gap-3 rounded-xl px-3 py-2.5 text-left text-ink"
      style={{ border, background: bg, opacity: state === 'skipped' ? 0.85 : 1 }}
    >
      <span className="w-[4px] flex-none self-stretch rounded-sm" style={{ background: s.dot }} />
      <span className="flex min-w-0 flex-auto flex-col">
        <span className={`truncate font-semibold ${state === 'skipped' ? 'line-through' : ''}`} style={{ color: fg }}>
          {event.title}
          {event.tentative ? '?' : ''}
        </span>
        <span className="truncate text-xs text-muted">{meta}</span>
      </span>
      {state === 'completed' && (
        <span className="flex flex-none items-center gap-1.5">
          <RpePill feedback={feedback} prompt />
          <DoneIcon size={16} aria-label="Completed" />
        </span>
      )}
      <ChevronRight className="flex-none text-[#9AA1AD]" />
    </button>
  );
}

/** A ride from intervals.icu that no planned session claimed. */
function RideCard({ activity, feedback, onOpen }: { activity: CalendarActivity; feedback: SessionFeedback | undefined; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[64px] items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-ink">
      <span className="w-[4px] flex-none self-stretch rounded-sm" style={{ background: RIDE_COLOR }} />
      <span className="flex min-w-0 flex-auto flex-col">
        <span className="truncate font-semibold">{activity.name.replace(/^Zwift - /, '')}</span>
        <span className="truncate text-xs text-muted">
          Ride · {Math.round(activity.movingSec / 60)} min{activity.trainingLoad !== undefined ? ` · load ${activity.trainingLoad}` : ''}
        </span>
      </span>
      <span className="flex flex-none items-center gap-1.5 text-xs font-semibold text-success">
        <RpePill feedback={feedback} />
        <DoneIcon size={16} aria-hidden="true" />
        Ridden
      </span>
      <ChevronRight className="flex-none text-[#9AA1AD]" />
    </button>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => formatMonthTitle(2000, i + 1).slice(0, 3));

/** Jump to a month: the week holding its 1st (today's week for the current month). */
function MonthPicker({
  shown,
  today,
  onClose,
  onPick,
}: {
  shown: { year: number; month: number };
  today: string;
  onClose: () => void;
  onPick: (week: string) => void;
}) {
  const [year, setYear] = useState(shown.year);
  const now = monthOf(today);
  return (
    <Sheet title="Jump to a month" onClose={onClose}>
      <div className="flex items-center justify-between">
        <IconButton aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
          <ChevronLeft size={18} strokeWidth={2.2} />
        </IconButton>
        <span className="font-mono text-base font-semibold">{year}</span>
        <IconButton aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
          <ChevronRight size={18} strokeWidth={2.2} />
        </IconButton>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {MONTHS.map((label, i) => {
          const month = i + 1;
          const isShown = year === shown.year && month === shown.month;
          const isNow = year === now.year && month === now.month;
          const first = `${year}-${String(month).padStart(2, '0')}-01`;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={isShown}
              onClick={() => onPick(isNow ? weekStart(today) : weekStart(first))}
              className={`min-h-[48px] rounded-xl text-sm ${isShown ? 'border-0 bg-ink font-semibold text-white' : 'bg-surface text-ink'}`}
              style={isShown ? undefined : { border: `1.5px solid ${isNow ? '#7DA30A' : '#E3E6EB'}` }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
