import { addDays, countEstimates, dayTimeline, formatLongDay, groupByDay, sessionState, sumNutrients, weekStart, type CalendarDay, type TimelineItem } from '@cycling-coach/core';
import type { CalendarActivity, CalendarEvent, IsoDate, SessionFeedback } from '@cycling-coach/shared';
import { useMemo } from 'react';
import { DoneIcon } from '../../components/icons';
import { RpePill } from '../../components/RpePill';
import { COMPLETED, feedbackForEvent, indexFeedback, type FeedbackIndex } from '../../lib/feedback';
import { fmtKcal, nowTime } from '../../lib/food';
import { useEnergyBudget, useFoodLibrary, useFoodLog } from '../../lib/foodQueries';
import { calendarChunkStart, useCalendarRange, useTimeOff } from '../../lib/queries';
import { SESSION_STYLE, durationText, kindLabel } from '../../lib/session';
import type { Selection } from './panels';
import { rideName, ridesMeta, rideTime, sessionRides } from './shared';

/** A session or an unplanned ride on a day's timeline. */
export interface DaySession {
  key: string;
  time?: string | undefined;
  event?: CalendarEvent | undefined;
  /** The session's rides, or the one unplanned ride. */
  rides: CalendarActivity[];
  feedback?: SessionFeedback | undefined;
  /** Planned and not ridden yet: today's timeline shows it just below "now". */
  pending?: boolean | undefined;
}

export const sessionSelection = (s: DaySession): Selection => (s.event ? { type: 'event', id: s.event.id } : { type: 'activity', id: s.rides[0]!.id });

/**
 * A day's sessions and unplanned rides, each with a start time when one is known — for a completed
 * session, when it was actually ridden rather than when it was planned.
 */
export function daySessions(day: CalendarDay | undefined, ridesById: ReadonlyMap<string, CalendarActivity>, ratings: FeedbackIndex): DaySession[] {
  if (!day) return [];
  return [
    ...day.events.map((e): DaySession => {
      const rides = sessionRides(e, ridesById);
      const state = sessionState(e);
      const ridden = rides[0] ? rideTime(rides[0]) : undefined;
      const time = state === 'completed' ? (ridden ?? e.startTime) : (e.startTime ?? ridden);
      return { key: e.id, time, event: e, rides, feedback: feedbackForEvent(ratings, e), pending: state === 'planned' };
    }),
    ...day.rides.map((a): DaySession => ({ key: a.id, time: rideTime(a), rides: [a], feedback: ratings.byActivity.get(a.id) })),
  ];
}

/** "Sun Nov 1 · Today" */
export const dayTitle = (date: IsoDate, today: IsoDate) =>
  `${formatLongDay(date)}${date === today ? ' · Today' : date === addDays(today, -1) ? ' · Yesterday' : date === addDays(today, 1) ? ' · Tomorrow' : ''}`;

export const sessionTitle = (s: DaySession) => s.event?.title ?? rideName(s.rides[0]!);

/** "Zwift workout · 75m", "72 min · load 86", "Missed · …" */
export function sessionMeta(s: DaySession): string {
  if (!s.event) return ridesMeta(s.rides);
  const state = sessionState(s.event);
  const planned = [kindLabel(s.event), durationText(s.event)].filter(Boolean).join(' · ');
  if (state === 'completed') return s.rides.length ? ridesMeta(s.rides) : planned;
  if (state === 'missed') return `Missed · ${planned}`;
  if (state === 'skipped') return 'Skipped';
  return planned;
}

/**
 * Everything one day shows: its sessions (from the calendar's 4-week chunks, so the
 * cache is shared with the grid), food log, budget and the merged timeline.
 */
export function useDay(date: IsoDate, today: IsoDate, includeEmpty: boolean) {
  const lib = useFoodLibrary();
  const log = useFoodLog(date);
  const budget = useEnergyBudget(date);
  // Two chunks, so the next day (the tomorrow card) is there even at a chunk's end.
  const start = calendarChunkStart(today, weekStart(date));
  const calendar = useCalendarRange(start, 8);
  const timeOff = useTimeOff(start, addDays(start, 8 * 7 - 1));
  const byDate = useMemo(() => groupByDay(calendar.events, calendar.activities), [calendar.events, calendar.activities]);
  const ratings = useMemo(() => indexFeedback(calendar.feedback), [calendar.feedback]);
  const ridesById = useMemo(() => new Map(calendar.activities.map((a) => [a.id, a])), [calendar.activities]);
  const sessions = useMemo(() => daySessions(byDate.get(date), ridesById, ratings), [byDate, date, ridesById, ratings]);
  const entries = log.data?.entries;
  const timeline: TimelineItem<DaySession>[] = useMemo(
    () =>
      lib.data && entries
        ? dayTimeline({ entries, slots: lib.data.settings.slots, sessions, now: date === today ? nowTime() : undefined, includeEmpty })
        : [],
    [lib.data, entries, sessions, date, today, includeEmpty],
  );
  const total = useMemo(() => sumNutrients((entries ?? []).map((e) => e.nutrients)), [entries]);
  const estimates = useMemo(() => countEstimates(entries ?? []), [entries]);
  return { lib, log, budget: budget.data, calendar, timeOff, byDate, ratings, ridesById, sessions, timeline, total, estimates, entries: entries ?? [] };
}

/** A session on a timeline: type colour bar, title, meta, done/RPE — opens the session panel. */
export function SessionCard({ s, onOpen, fuelKcal, compact = false }: { s: DaySession; onOpen: () => void; fuelKcal?: number | undefined; compact?: boolean }) {
  const state = s.event ? sessionState(s.event) : 'completed';
  const color = s.event ? SESSION_STYLE[s.event.type].dot : '#A3AAB6';
  const done = state === 'completed';
  const meta = [sessionMeta(s), fuelKcal ? `fuel ${fmtKcal(fuelKcal)} kcal` : ''].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full min-w-0 items-stretch gap-2.5 overflow-hidden rounded-[12px] border text-left text-ink ${compact ? 'min-h-[52px]' : 'min-h-[64px]'}`}
      style={{
        background: done ? COMPLETED.bg : '#FFFFFF',
        borderColor: done ? COMPLETED.border : state === 'missed' ? '#F1B5B0' : '#E3E6EB',
        borderStyle: state === 'missed' || s.event?.tentative ? 'dashed' : 'solid',
      }}
    >
      <span aria-hidden="true" className="w-1 flex-none" style={{ background: color }} />
      <span className="flex min-w-0 flex-auto flex-col justify-center gap-0.5 py-2 pr-3">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-muted uppercase">{s.event ? 'Training' : 'Ride'}</span>
        <span className="flex items-center gap-1.5 font-semibold">
          {done && <DoneIcon size={14} className="flex-none" style={{ color: COMPLETED.fg }} aria-label="Done" />}
          <span className={`truncate ${state === 'skipped' ? 'line-through' : ''}`}>{sessionTitle(s)}</span>
        </span>
        <span className="truncate text-xs text-muted">{meta}</span>
        {done && <RpePill feedback={s.feedback} prompt={!!s.event} className="self-start" />}
      </span>
    </button>
  );
}
