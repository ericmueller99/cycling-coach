import { addDays, sessionState, sumNutrients, timeOffOn, weekStart } from '@cycling-coach/core';
import type { FoodLogEntry, IsoDate } from '@cycling-coach/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from '../../components/icons';
import { Button, Card, ErrorNote, PageHeader, Spinner } from '../../components/ui';
import { fmtKcal, fmtTime } from '../../lib/food';
import { useEnergyBudget } from '../../lib/foodQueries';
import { errorMessage, useDashboard } from '../../lib/queries';
import { EnergyCard, MacrosCard } from '../food/EnergyCard';
import { LogBar } from '../food/LogBar';
import { MealSection } from '../food/MealSection';
import { dayTitle, SessionCard, sessionSelection, sessionTitle, useDay } from './day';
import { fuelLine, useDayActions } from './DayView';
import { TimeOffCard } from './time-off';

/** Day | Week — the day view and the scrolling week grid. */
export function DayWeekSwitch({ date }: { date: IsoDate }) {
  const cls = 'flex min-h-8 items-center rounded-lg px-3 text-[13px] no-underline';
  return (
    <div role="group" aria-label="View" className="flex rounded-[10px] border border-line-strong bg-surface p-[3px]">
      <span aria-current="page" className={`${cls} bg-track font-semibold text-ink`}>
        Day
      </span>
      <Link to="/calendar" search={{ week: weekStart(date) }} className={`${cls} text-muted hover:text-ink`}>
        Week
      </Link>
    </div>
  );
}

/**
 * The day view: one time-ordered timeline of meals and sessions — Workout
 * fuel nested in the ride — with the log bar on top and energy + macros beside it.
 */
export function DayPage({ date, today }: { date: IsoDate; today: IsoDate }) {
  const navigate = useNavigate();
  const d = useDay(date, today, true);
  const a = useDayActions(date, today, d);
  const dash = useDashboard();
  const tomorrowBudget = useEnergyBudget(a.tomorrow).data;
  const tomorrow = d.byDate.get(a.tomorrow);
  const go = (to: IsoDate) => void navigate({ to: '/calendar/$date', params: { date: to } });
  const lib = d.lib.data;
  const error = d.lib.error ?? d.log.error;
  const fuelSub = fuelLine(d.budget?.exercise);
  const off = timeOffOn(d.timeOff, date);

  const meal = (m: { slot: string; time?: string | undefined; entries: FoodLogEntry[] }, subline?: string) => (
    <MealSection
      name={m.slot}
      time={m.time}
      subline={subline}
      items={m.entries}
      total={sumNutrients(m.entries.map((e) => e.nutrients))}
      mobile={false}
      onAdd={() => a.flows.logFood(m.slot)}
      onEntry={(entry) => a.flows.setFlow({ kind: 'entry', entry })}
      onSaveMeal={() => a.saveAsMeal(m.slot, m.entries)}
    />
  );

  return (
    <>
      <PageHeader title={dayTitle(date, today)} subtitle={dash.data ? `${dash.data.snapshot.weightKg.toFixed(1)} kg trend` : undefined}>
        <div className="flex">
          <button type="button" aria-label="Previous day" onClick={() => go(addDays(date, -1))} className="flex h-10 w-9 items-center justify-center rounded-l-[10px] border border-line-strong bg-surface">
            <ChevronLeft />
          </button>
          <button type="button" aria-label="Next day" onClick={() => go(addDays(date, 1))} className="-ml-px flex h-10 w-9 items-center justify-center rounded-r-[10px] border border-line-strong bg-surface">
            <ChevronRight />
          </button>
        </div>
        {date !== today && (
          <Button variant="ghost" onClick={() => go(today)}>
            Today
          </Button>
        )}
        <DayWeekSwitch date={date} />
        <Button onClick={() => a.setPanel({ type: 'add', date })}>+ Session</Button>
        <Button onClick={() => a.setPanel({ type: 'time-off-add', date })}>+ Time off</Button>
        <Button variant="primary" onClick={() => a.flows.logFood()}>
          + Food
        </Button>
      </PageHeader>
      <div className="flex flex-wrap items-start gap-5 px-7 pt-5 pb-8">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          {lib && (
            <LogBar
              lib={lib}
              date={date}
              today={today}
              mobile={false}
              onAI={(phrase, slot) => a.flows.words(phrase, slot)}
              onPortion={(item, slot) => a.flows.setFlow({ kind: 'log', slot, preselect: { kind: item.kind, id: item.id } })}
              onStaples={(query, slot) => a.flows.setFlow({ kind: 'log', slot, query, staples: true })}
            />
          )}
          {off.map((t) => (
            <TimeOffCard key={t.id} entry={t} onOpen={() => a.setPanel({ type: 'time-off', entry: t })} />
          ))}
          {error ? (
            <ErrorNote>{errorMessage(error)}</ErrorNote>
          ) : d.lib.isPending || d.log.isPending ? (
            <Spinner />
          ) : (
            <ol aria-label="Day timeline" className="m-0 flex list-none flex-col gap-3 p-0">
              {d.timeline.map((it) => {
                if (it.kind === 'now') {
                  return (
                    <li key="now" className="flex items-center gap-3 text-xs font-semibold text-danger">
                      <span className="w-16 flex-none text-right font-mono">{fmtTime(it.time)}</span>
                      <span className="h-0.5 flex-auto rounded bg-danger" />
                      Now
                    </li>
                  );
                }
                const time = (
                  <span className="w-16 flex-none pt-3 text-right font-mono text-xs leading-tight text-muted">
                    {it.time ? fmtTime(it.time) : it.kind === 'session' ? 'Any time' : ''}
                  </span>
                );
                if (it.kind === 'meal') {
                  return (
                    <li key={`meal-${it.slot}`} className="flex gap-3">
                      {time}
                      <div className="min-w-0 flex-auto">{meal(it, /workout fuel|ride fuel/i.test(it.slot) ? fuelSub : undefined)}</div>
                    </li>
                  );
                }
                return (
                  <li key={it.session.key} className="flex gap-3">
                    {time}
                    <div className="flex min-w-0 flex-auto flex-col gap-2">
                      <SessionCard s={it.session} onOpen={() => a.setPanel(sessionSelection(it.session))} />
                      {it.fuel && <div className="ml-4 border-l-2 border-accent-line pl-3">{meal(it.fuel, it.fuel.entries.length ? undefined : `during ${sessionTitle(it.session)}`)}</div>}
                    </div>
                  </li>
                );
              })}
              {!d.sessions.length && !off.length && (
                <li className="flex gap-3">
                  <span className="w-16 flex-none" />
                  <button
                    type="button"
                    onClick={() => a.setPanel({ type: 'add', date })}
                    className="min-h-[48px] flex-auto rounded-xl border border-dashed border-[#C5CBD4] bg-transparent text-[13px] text-muted"
                  >
                    {date < today ? 'Rest day' : 'No training'} · + Add session
                  </button>
                </li>
              )}
              <li className="flex gap-3">
                <span className="w-16 flex-none pt-3 text-right font-mono text-xs text-muted">Tomorrow</span>
                <Link to="/calendar/$date" params={{ date: a.tomorrow }} className="flex min-w-0 flex-auto flex-col gap-0.5 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-ink no-underline hover:text-ink">
                  <span className="text-[10px] font-semibold tracking-[0.06em] text-muted uppercase">{dayTitle(a.tomorrow, today)}</span>
                  <span className="font-semibold">
                    {tomorrow?.events.filter((e) => sessionState(e) !== 'skipped').map((e) => e.title).join(' · ') || 'No training planned'}
                  </span>
                  {tomorrowBudget?.ready && <span className="text-xs text-muted">budget ≈ {fmtKcal(tomorrowBudget.total)} kcal</span>}
                </Link>
              </li>
            </ol>
          )}
        </div>
        <aside aria-label="Day summary" className="sticky top-5 flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <EnergyCard budget={d.budget} eaten={d.total.kcal} isToday={date === today} />
          <MacrosCard total={d.total} budget={d.budget?.ready ? d.budget : undefined} />
          {!d.budget && <Card className="p-4 text-[13px] text-muted">Loading the day's budget…</Card>}
        </aside>
      </div>
      {a.elements}
    </>
  );
}
