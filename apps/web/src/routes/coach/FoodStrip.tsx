import { addDays, formatLongDay } from '@cycling-coach/core';
import type { IsoDate } from '@cycling-coach/shared';
import { useId, useState } from 'react';
import { ChevronDown } from '../../components/icons';
import { inputCls } from '../../components/ui';
import { fmtKcal } from '../../lib/food';
import { useEnergyBudget, useFoodLibrary, useFoodLog } from '../../lib/foodQueries';
import { calendarChunkStart, CALENDAR_CHUNK_WEEKS, useCalendarRange } from '../../lib/queries';

/** kcal and protein left on a day (budget − logged), null when there's no budget yet. */
export function useFoodLeft(date: IsoDate): { kcalLeft: number | null; proteinLeft: number | null } {
  const budget = useEnergyBudget(date).data;
  const log = useFoodLog(date).data;
  const eaten = (log?.entries ?? []).reduce((s, e) => ({ kcal: s.kcal + e.nutrients.kcal, protein: s.protein + e.nutrients.protein }), { kcal: 0, protein: 0 });
  return {
    kcalLeft: budget?.ready ? budget.total - eaten.kcal : null,
    proteinLeft: budget?.macros ? Math.max(0, budget.macros.proteinG - eaten.protein) : null,
  };
}

/**
 * "Planning with" strip above the composer on food threads: the meal and day the
 * coach plans for (sent with each message, and the recipe pane's log default), what's left today,
 * and tomorrow's session.
 */
export function FoodStrip({ slot, date, today, onChange }: { slot: string; date: IsoDate; today: IsoDate; onChange: (slot: string, date: IsoDate) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { data: lib } = useFoodLibrary();
  const { kcalLeft, proteinLeft } = useFoodLeft(date);
  const tomorrow = addDays(date, 1);
  const cal = useCalendarRange(calendarChunkStart(today, tomorrow), CALENDAR_CHUNK_WEEKS);
  const next = cal.events.find((e) => e.date === tomorrow && e.status !== 'missed');

  const chip = 'inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-[12.5px] whitespace-nowrap';

  return (
    <div className="flex flex-col gap-2">
    <div className="flex items-center gap-1.5 overflow-x-auto mobile:scrollbar-none">
      <span className="flex-none text-[11px] font-semibold tracking-[0.06em] text-muted uppercase mobile:hidden">Planning with</span>
      <button type="button" aria-expanded={open} aria-controls={`${id}-pick`} onClick={() => setOpen((o) => !o)} className={`${chip} border-accent-line bg-accent-tint font-medium text-accent-ink`}>
        {slot} · {formatLongDay(date)} <ChevronDown size={12} />
      </button>
      {kcalLeft != null && <span className={`${chip} font-mono ${kcalLeft < 0 ? 'text-danger' : ''}`}>{kcalLeft < 0 ? `${fmtKcal(-kcalLeft)} kcal over` : `${fmtKcal(kcalLeft)} kcal left`}</span>}
      {proteinLeft != null && <span className={`${chip} font-mono`}>{Math.round(proteinLeft)} g protein left</span>}
      {next && <span className={`${chip} text-muted`}>{date === today ? 'Tomorrow' : formatLongDay(tomorrow)}: {next.title}</span>}
    </div>
      {open && lib && (
        <div id={`${id}-pick`} className="flex flex-wrap gap-2 self-start rounded-[10px] border border-line bg-surface p-2">
          <label className="sr-only" htmlFor={`${id}-slot`}>
            Meal
          </label>
          <select id={`${id}-slot`} value={slot} onChange={(e) => onChange(e.target.value, date)} className={inputCls}>
            {lib.settings.slots.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor={`${id}-date`}>
            Day
          </label>
          <input id={`${id}-date`} type="date" value={date} onChange={(e) => e.target.value && onChange(slot, e.target.value)} className={inputCls} />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border-0 bg-ink px-3 text-[13px] text-white">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
