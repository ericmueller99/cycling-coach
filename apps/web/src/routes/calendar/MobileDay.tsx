import { addDays, dayOfMonth, formatLongDay, formatRange, sessionState, sumNutrients, timeOffOn, weekDates, weekStart, WEEKDAY_LABELS } from '@cycling-coach/core';
import type { IsoDate } from '@cycling-coach/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, type TouchEvent } from 'react';
import { AppBar, IconButton } from '../../components/AppBar';
import { ChevronLeft, ChevronRight, PlusIcon } from '../../components/icons';
import { KcalBar } from '../../components/KcalBar';
import { ErrorNote, Spinner } from '../../components/ui';
import { fmtTime } from '../../lib/food';
import { useDaysRange } from '../../lib/foodQueries';
import { calendarChunkStart, errorMessage } from '../../lib/queries';
import { SESSION_STYLE, TIME_OFF_STYLE } from '../../lib/session';
import { MobileEnergy } from '../food/EnergyCard';
import { LogBar } from '../food/LogBar';
import { MealSection } from '../food/MealSection';
import { dayTitle, SessionCard, sessionSelection, useDay } from './day';
import { fuelLine, useDayActions } from './DayView';
import { TimeOffCard } from './time-off';

/** Training dot on the strip: done green, planned in its type colour, nothing grey. */
function trainingDot(events: { status: string; type: keyof typeof SESSION_STYLE }[] | undefined, rides: number): string | null {
  if (events?.some((e) => e.status === 'done') || rides) return '#15803D';
  const planned = events?.find((e) => e.status === 'planned');
  return planned ? SESSION_STYLE[planned.type].dot : null;
}

/**
 * The phone calendar: a week strip with a training dot and a food bar
 * per day, then one day's timeline — training and food together. Swipe the page to change week;
 * "Week" switches to the week agenda.
 */
export function MobileDay({ today, date }: { today: IsoDate; date: IsoDate }) {
  const navigate = useNavigate();
  const d = useDay(date, today, true);
  const a = useDayActions(date, today, d);
  const week = weekStart(date);
  const dates = weekDates(date);
  const food = useDaysRange(calendarChunkStart(today, week), 4);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const lib = d.lib.data;
  const error = d.lib.error ?? d.log.error;
  const fuelSub = fuelLine(d.budget?.exercise);
  const off = timeOffOn(d.timeOff, date);

  const go = (to: IsoDate) => void navigate({ to: '/calendar/$date', params: { date: to }, replace: true });
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
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(addDays(date, dx < 0 ? 7 : -7));
  };

  return (
    <div className="flex grow flex-col" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <AppBar
        title="Calendar"
        border={false}
        actions={
          <>
            {date !== today && (
              <button type="button" onClick={() => go(today)} className="min-h-[36px] rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink">
                Today
              </button>
            )}
            <Link to="/calendar" search={{ week }} className="ml-1 flex min-h-[36px] items-center rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink no-underline hover:text-ink">
              Week
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-1.5 border-b border-line px-2 pb-2.5">
          <div className="flex items-center">
            <IconButton aria-label="Previous week" onClick={() => go(addDays(date, -7))}>
              <ChevronLeft size={18} strokeWidth={2.2} />
            </IconButton>
            <span className="flex-auto text-center text-[13px] font-semibold">{formatRange(week, addDays(week, 6))}</span>
            <IconButton aria-label="Next week" onClick={() => go(addDays(date, 7))}>
              <ChevronRight size={18} strokeWidth={2.2} />
            </IconButton>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {dates.map((day, i) => {
              const cal = d.byDate.get(day);
              const off = timeOffOn(d.timeOff, day)[0];
              const dot = trainingDot(cal?.events, cal?.rides.length ?? 0) ?? (off ? TIME_OFF_STYLE[off.kind].dot : null);
              const f = food.days.get(day);
              const pct = f?.eaten && f.budget ? f.eaten.kcal / f.budget : 0;
              const isToday = day === today;
              const on = day === date;
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={formatLongDay(day)}
                  onClick={() => go(day)}
                  className="flex min-h-[70px] flex-col items-center gap-1 rounded-xl py-1.5 text-ink"
                  style={{ background: on ? '#15181E' : isToday ? '#F4FADF' : '#FFFFFF', color: on ? '#FFFFFF' : undefined, border: `1.5px solid ${on ? '#15181E' : isToday ? '#7DA30A' : '#EDEFF2'}` }}
                >
                  <span className={`text-[11px] ${on ? 'text-white/70' : 'text-muted'}`}>{WEEKDAY_LABELS[i]}</span>
                  <span className="font-mono text-[15px] font-semibold">{dayOfMonth(day)}</span>
                  <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot ?? (on ? 'rgba(255,255,255,.25)' : '#E3E6EB') }} />
                  <KcalBar
                    eaten={pct > 0 ? f!.eaten!.kcal : 0}
                    budget={f?.budget ?? 1}
                    fill={on ? '#C8F25A' : '#3F6212'}
                    track={on ? 'rgba(255,255,255,.25)' : '#EEF0F3'}
                    className="h-1 w-[26px] rounded-sm"
                  />
                </button>
              );
            })}
          </div>
        </div>
      </AppBar>

      <div className="flex items-baseline justify-between px-4 pt-3">
        <h2 className="m-0 text-[17px]">{dayTitle(date, today)}</h2>
      </div>
      <MobileEnergy total={d.total} budget={d.budget} isToday={date === today} />

      <div className="flex flex-col gap-3 px-4 pt-3 pb-28">
        {off.map((t) => (
          <TimeOffCard key={t.id} entry={t} onOpen={() => a.setPanel({ type: 'time-off', entry: t })} />
        ))}
        {lib && (
          <LogBar
            lib={lib}
            date={date}
            today={today}
            mobile
            onAI={(phrase, slot) => a.flows.words(phrase, slot)}
            onPortion={(item, slot) => a.flows.setFlow({ kind: 'log', slot, preselect: { kind: item.kind, id: item.id } })}
            onStaples={(query, slot) => a.flows.setFlow({ kind: 'log', slot, query, staples: true })}
          />
        )}
        {error ? (
          <ErrorNote>{errorMessage(error)}</ErrorNote>
        ) : d.lib.isPending || d.log.isPending ? (
          <Spinner />
        ) : (
          d.timeline.map((it) => {
            if (it.kind === 'now') {
              return (
                <div key="now" className="flex items-center gap-2 text-[11px] font-semibold text-danger">
                  <span className="font-mono">{fmtTime(it.time)}</span>
                  <span className="h-0.5 flex-auto rounded bg-danger" /> Now
                </div>
              );
            }
            if (it.kind === 'meal') {
              return (
                <MealSection
                  key={`meal-${it.slot}`}
                  name={it.slot}
                  time={it.time}
                  subline={/workout fuel|ride fuel/i.test(it.slot) ? fuelSub : it.time ? fmtTime(it.time) : undefined}
                  items={it.entries}
                  total={sumNutrients(it.entries.map((e) => e.nutrients))}
                  mobile
                  onAdd={() => a.flows.logFood(it.slot)}
                  onEntry={(entry) => a.flows.setFlow({ kind: 'entry', entry })}
                  onSaveMeal={() => a.saveAsMeal(it.slot, it.entries)}
                />
              );
            }
            return (
              <div key={it.session.key} className="flex flex-col gap-1">
                {it.time && <span className="font-mono text-[11px] text-muted">{fmtTime(it.time)}</span>}
                <SessionCard s={it.session} onOpen={() => a.setPanel(sessionSelection(it.session))} fuelKcal={it.fuel?.entries.length ? it.fuel.kcal : undefined} />
                {it.fuel && !it.fuel.entries.length && it.session.event && sessionState(it.session.event) !== 'skipped' && (
                  <button type="button" onClick={() => a.flows.logFood(it.fuel!.slot)} className="self-start border-0 bg-transparent p-0 text-[13px] text-accent-ink">
                    + Workout fuel
                  </button>
                )}
              </div>
            );
          })
        )}
        {!d.sessions.length && !off.length && !d.calendar.pending && (
          <button type="button" onClick={() => a.setPanel({ type: 'add', date })} className="min-h-[48px] rounded-xl border border-dashed border-[#C5CBD4] bg-transparent text-[13px] text-muted">
            {date < today ? 'Rest day' : 'No training'} · + Add session
          </button>
        )}
      </div>

      <div className="fixed inset-x-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex gap-2">
        <button
          type="button"
          onClick={() => a.setPanel({ type: 'add', date })}
          className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[26px] border border-line-strong bg-surface font-semibold text-ink shadow-[0_4px_12px_rgba(0,0,0,.08)]"
        >
          <PlusIcon size={18} /> Session
        </button>
        <button
          type="button"
          onClick={() => a.setPanel({ type: 'time-off-add', date })}
          className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[26px] border border-line-strong bg-surface font-semibold whitespace-nowrap text-ink shadow-[0_4px_12px_rgba(0,0,0,.08)]"
        >
          <PlusIcon size={18} /> Time off
        </button>
        <button
          type="button"
          onClick={() => a.flows.logFood()}
          className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[26px] border-0 bg-accent font-semibold text-on-accent shadow-[0_4px_12px_rgba(0,0,0,.08)]"
        >
          <PlusIcon size={18} /> Food
        </button>
      </div>
      {a.elements}
    </div>
  );
}
