import { countEstimates, dayTimeline, isEstimate, sumNutrients, type CalendarDay } from '@cycling-coach/core';
import type { CalendarActivity, FoodLogEntry, IsoDate, TimeOff } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { KcalBar } from '../../components/KcalBar';
import { Button, SectionLabel } from '../../components/ui';
import type { FeedbackIndex } from '../../lib/feedback';
import { approx, entryLine, fmtKcal, fmtTime, includesEstimates, nowTime } from '../../lib/food';
import { useEnergyBudget, useFoodLibrary, useFoodLog } from '../../lib/foodQueries';
import { EntryThumb } from '../food/EntryPhotos';
import { SourceTag } from '../food/SourceTag';
import { daySessions, dayTitle, sessionMeta, sessionSelection, sessionTitle } from './day';
import type { Selection } from './panels';
import { PANEL } from './shared';
import { TimeOffCard } from './time-off';

/** The time gutter: every row has one, so cards line up whether or not they have a time. */
const GUTTER = 'w-[54px] flex-none pt-2 text-right font-mono text-[11px] leading-tight text-muted';

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtKcal(Math.abs(n))}`;

/**
 * The calendar's day panel: energy for the day, + Food / + Session / Open
 * day, and a compact timeline of meals and sessions in time order.
 */
export function DayPanel({
  date,
  today,
  trendKg,
  day,
  timeOff,
  ridesById,
  ratings,
  onClose,
  onSelect,
  onFood,
  onEntry,
}: {
  date: IsoDate;
  today: IsoDate;
  trendKg: number | null | undefined;
  day: CalendarDay | undefined;
  /** What covers this day. */
  timeOff: readonly TimeOff[];
  ridesById: ReadonlyMap<string, CalendarActivity>;
  ratings: FeedbackIndex;
  onClose: () => void;
  onSelect: (s: Selection) => void;
  onFood: (slot?: string) => void;
  onEntry: (entry: FoodLogEntry) => void;
}) {
  const lib = useFoodLibrary();
  const log = useFoodLog(date);
  const budget = useEnergyBudget(date).data;
  const sessions = useMemo(() => daySessions(day, ridesById, ratings), [day, ridesById, ratings]);
  const entries = log.data?.entries;
  const items = useMemo(
    () => (lib.data && entries ? dayTimeline({ entries, slots: lib.data.settings.slots, sessions, now: date === today ? nowTime() : undefined }) : []),
    [lib.data, entries, sessions, date, today],
  );
  const eaten = sumNutrients((entries ?? []).map((e) => e.nutrients)).kcal;
  const estimates = countEstimates(entries ?? []);
  const est = approx(estimates);
  const future = date > today;
  const ready = budget?.ready;

  return (
    <aside aria-label={`Day: ${dayTitle(date, today)}`} className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <SectionLabel>Day</SectionLabel>
          <h2 className="mt-1 mb-0 text-[20px]">{dayTitle(date, today)}</h2>
          {trendKg != null && <div className="font-mono text-xs text-muted">{trendKg.toFixed(1)} kg trend</div>}
        </div>
        <button type="button" onClick={onClose} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface p-3">
        {!budget ? (
          <span className="text-[13px] text-muted">Loading…</span>
        ) : !ready ? (
          <span className="text-[13px] text-muted">
            {est}
            {fmtKcal(eaten)} kcal eaten. <Link to="/athlete/$tab" params={{ tab: 'body' }}>Set your RMR</Link> to see a budget.
          </span>
        ) : future ? (
          <>
            <span className="text-xs text-muted">Planned budget</span>
            <span className="font-mono text-[24px] leading-tight font-semibold">{fmtKcal(budget.total)} kcal</span>
            <span className="text-xs text-muted">Updates when sessions sync.</span>
          </>
        ) : (
          <>
            <span className={`font-mono text-[24px] leading-tight font-semibold ${eaten > budget.total ? 'text-danger' : ''}`}>
              {est}
              {date === today ? `${fmtKcal(Math.abs(budget.total - eaten))} kcal ${eaten > budget.total ? 'over' : 'left'}` : `${signed(eaten - budget.total)} kcal vs budget`}
            </span>
            <KcalBar eaten={eaten} budget={budget.total} className="h-2 rounded-[4px]" />
            <span className="text-xs text-muted">
              <strong className="text-ink">
                {est}
                {fmtKcal(eaten)}
              </strong>{' '}
              eaten / <strong className="text-ink">{fmtKcal(budget.total)}</strong> budget
            </span>
            {estimates > 0 && <span className="text-xs text-muted">{includesEstimates(estimates)}</span>}
          </>
        )}
      </div>

      {timeOff.map((t) => (
        <TimeOffCard key={t.id} entry={t} onOpen={() => onSelect({ type: 'time-off', entry: t })} />
      ))}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className="flex-auto" onClick={() => onFood()}>
          + Food
        </Button>
        <Button className="flex-auto" onClick={() => onSelect({ type: 'add', date })}>
          + Session
        </Button>
        <Button className="flex-auto" onClick={() => onSelect({ type: 'time-off-add', date })}>
          + Time off
        </Button>
        <Link to="/calendar/$date" params={{ date }} className="inline-flex min-h-10 items-center rounded-[10px] border border-line-strong bg-surface px-3.5 font-medium text-ink no-underline hover:text-ink">
          Open day
        </Link>
      </div>

      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((it) => {
          if (it.kind === 'now') {
            return (
              <li key="now" className="flex items-center gap-2 text-[11px] font-semibold text-danger">
                <span className="w-[54px] text-right font-mono">{fmtTime(it.time)}</span>
                <span className="h-px flex-auto bg-danger" /> Now
              </li>
            );
          }
          // An untimed session (most planned ones from intervals.icu) says so rather than leaving a gap.
          const time = it.time ? fmtTime(it.time) : it.kind === 'session' ? 'Any time' : '';
          if (it.kind === 'meal') {
            const guesses = it.entries.filter(isEstimate);
            return (
              <li key={`meal-${it.slot}`} className="flex gap-2">
                <span className={GUTTER}>{time}</span>
                <div className="flex min-w-0 flex-auto flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
                  <button type="button" onClick={() => onFood(it.slot)} className="flex min-w-0 flex-col gap-0.5 border-0 bg-transparent px-3 py-2 text-left text-ink">
                    <span className="text-[10px] font-semibold tracking-[0.06em] text-muted uppercase">Food</span>
                    <span className="flex justify-between gap-2">
                      <span className="truncate font-semibold">{it.slot}</span>
                      <span className="font-mono text-[13px]">
                        {approx(guesses.length)}
                        {fmtKcal(it.kcal)}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted">{it.entries.filter((e) => !isEstimate(e)).map((e) => e.name).join(', ')}</span>
                  </button>
                  {guesses.map((e) => (
                    <button key={e.id} type="button" onClick={() => onEntry(e)} className="flex min-w-0 items-center gap-2 border-0 border-t border-divider bg-transparent px-3 py-2 text-left text-ink hover:bg-surface-2">
                      <EntryThumb entry={e} />
                      <span className="min-w-0 flex-auto">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium">{e.name}</span>
                          <SourceTag source="estimate" />
                        </span>
                        <span className="block truncate text-xs text-muted">{entryLine(e)}</span>
                      </span>
                      <span className="flex-none font-mono text-[13px]">≈ {fmtKcal(e.nutrients.kcal)}</span>
                    </button>
                  ))}
                </div>
              </li>
            );
          }
          return (
            <li key={it.session.key} className="flex gap-2">
              <span className={GUTTER}>{time}</span>
              <button
                type="button"
                onClick={() => onSelect(sessionSelection(it.session))}
                className="flex min-w-0 flex-auto flex-col gap-0.5 rounded-[10px] border border-[#ABEFC6] bg-[#ECFDF3] px-3 py-2 text-left text-ink"
                style={it.session.event && it.session.event.status !== 'done' ? { background: '#FFFFFF', borderColor: '#E3E6EB' } : undefined}
              >
                <span className="text-[10px] font-semibold tracking-[0.06em] text-muted uppercase">Training</span>
                <span className="truncate font-semibold">{sessionTitle(it.session)}</span>
                <span className="truncate text-xs text-muted">
                  {[sessionMeta(it.session), it.fuel?.entries.length ? `fuel ${fmtKcal(it.fuel.kcal)} kcal` : ''].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
        {!sessions.length && <Placeholder>{future ? 'No training planned' : 'Rest day — no training'}</Placeholder>}
        {!entries?.length && <Placeholder>No food logged yet</Placeholder>}
      </ol>
    </aside>
  );
}

function Placeholder({ children }: { children: string }) {
  return (
    <li className="flex gap-2">
      <span className={GUTTER} />
      <span className="flex-auto rounded-[10px] border border-dashed border-line-strong px-3 py-2 text-[13px] text-muted">{children}</span>
    </li>
  );
}
