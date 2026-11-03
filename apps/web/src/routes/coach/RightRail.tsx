import { dayOfMonth, formatDayLabel, formatLongDay, WEEKDAY_LABELS } from '@cycling-coach/core';
import type { CalendarEvent, DashboardPayload } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { ChevronDown } from '../../components/icons';
import { Button, Card, ProgressBar, SectionLabel, SessionTag, StatTile } from '../../components/ui';
import { ZwiftWeightAlert } from '../../components/ZwiftWeightAlert';
import { SESSION_STYLE, durationText } from '../../lib/session';
import { useCalendarMutations, useDashboard } from '../../lib/queries';
import { RIGHT_COL } from './rightColumn';

/** The session the Today card and strip show: the first still planned, else whatever today held. */
const todaysSession = (data: DashboardPayload) => data.todayEvents.find((e) => e.status === 'planned') ?? data.todayEvents[0];

/** Mark done / Skip for today's session, or undo once it's settled. */
function TodayActions({ event }: { event: CalendarEvent }) {
  const { patch } = useCalendarMutations();
  if (event.status !== 'planned') {
    return (
      <div className="text-[13px] text-muted">
        {event.status === 'done' ? 'Done' : 'Skipped'} ·{' '}
        <button
          type="button"
          className="border-0 bg-transparent p-0 text-accent-ink mobile:min-h-[44px]"
          onClick={() => patch.mutate({ id: event.id, patch: { status: 'planned' } })}
        >
          undo
        </button>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <Button variant="primary" className="flex-1" disabled={patch.isPending} onClick={() => patch.mutate({ id: event.id, patch: { status: 'done' } })}>
        Mark done
      </Button>
      <Button variant="ghost" className="flex-1" disabled={patch.isPending} onClick={() => patch.mutate({ id: event.id, patch: { status: 'skipped' } })}>
        Skip
      </Button>
    </div>
  );
}

function MiniTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-line bg-surface p-2">
      <div className="text-[11px] text-muted">{label}</div>
      {children}
    </div>
  );
}

/**
 * The right rail folded into one row under the mobile top bar: today's
 * session, expanding to its notes, FTP / W/kg / next race and Mark done / Skip.
 */
export function TodayStrip({ onAsk }: { onAsk: (prompt: string) => void }) {
  const { data } = useDashboard();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const today = todaysSession(data);
  const s = today ? SESSION_STYLE[today.type] : null;
  return (
    <div className="border-b border-line bg-surface-alt">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[52px] w-full items-center gap-2.5 border-0 bg-transparent px-4 py-2 text-left text-ink"
      >
        <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={s ? { color: s.fg, background: s.bg } : undefined}>
          Today
        </span>
        <span className="min-w-0 flex-auto truncate font-semibold">
          {today ? [today.title, durationText(today)].filter(Boolean).join(' · ') : 'Nothing planned'}
        </span>
        <ChevronDown size={16} className={`flex-none text-muted ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 px-4 pb-3">
          {today && (today.coachNote || today.meta) && <div className="text-[13px] text-muted">{today.coachNote ?? today.meta}</div>}
          <div className="grid grid-cols-3 gap-2">
            <MiniTile label="FTP">
              <div className="font-mono font-semibold">{data.snapshot.ftpZwift} W</div>
            </MiniTile>
            <MiniTile label="W/kg">
              <div className="font-mono font-semibold">{data.snapshot.wattsPerKg.toFixed(2)}</div>
            </MiniTile>
            <MiniTile label="Next race">
              <div className="truncate text-[13px] font-semibold" title={data.nextRace?.title}>
                {data.nextRace ? formatDayLabel(data.nextRace.date) : '—'}
              </div>
            </MiniTile>
          </div>
          {today ? (
            <TodayActions event={today} />
          ) : (
            <Button variant="ghost" onClick={() => onAsk('What should I ride today?')}>
              Ask the coach
            </Button>
          )}
          <ZwiftWeightAlert zwiftKg={data.snapshot.zwiftWeightKg} trendKg={data.snapshot.weightKg} synced={data.snapshot.zwiftWeightSynced} compact />
        </div>
      )}
    </div>
  );
}

export function RightRail({ onAsk }: { onAsk: (prompt: string) => void }) {
  const { data } = useDashboard();
  if (!data) return <aside className={`bg-surface-alt ${RIGHT_COL}`} />;
  const today = todaysSession(data);
  const goal = data.mainGoal;

  return (
    <aside aria-label="Today and snapshot" className={`flex flex-col gap-4 bg-surface-alt px-5 py-6 @min-[940px]:overflow-y-auto ${RIGHT_COL}`}>
      <Card className="flex flex-col gap-2.5 p-4">
        <SectionLabel>Today · {formatLongDay(data.today)}</SectionLabel>
        {today ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SessionTag type={today.type} tentative={today.tentative} />
              <span className="font-semibold">{today.title}</span>
              {durationText(today) && <span className="font-mono text-xs text-muted">{durationText(today)}</span>}
            </div>
            {(today.coachNote || today.meta) && <div className="text-[13px] text-muted">{today.coachNote ?? today.meta}</div>}
            <TodayActions event={today} />
          </>
        ) : (
          <>
            <div className="text-[13px] text-muted">Nothing planned today.</div>
            <Button variant="ghost" onClick={() => onAsk('What should I ride today?')}>
              Ask the coach
            </Button>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <SectionLabel>This week</SectionLabel>
          <Link to="/calendar" className="text-[13px]">
            Calendar
          </Link>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {data.week.map((d, i) => {
            const isToday = d.date === data.today;
            const first = d.events[0];
            return (
              <div
                key={d.date}
                className="flex flex-col items-center gap-1.5 rounded-lg py-2"
                style={{ background: isToday ? '#F1F8DC' : '#F3F4F6', border: `1px solid ${isToday ? '#7DA30A' : 'transparent'}` }}
                title={d.events.map((e) => e.title).join(', ') || 'Nothing planned'}
              >
                <span className="text-[11px] text-muted">{WEEKDAY_LABELS[i]}</span>
                <span className="font-mono text-[13px] font-semibold">{dayOfMonth(d.date)}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: first ? SESSION_STYLE[first.type].dot : 'transparent' }} />
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2.5 text-[11px] text-muted">
          {(['race', 'intervals', 'endurance', 'recovery'] as const).map((t) => (
            <span key={t} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: SESSION_STYLE[t].dot }} />
              {SESSION_STYLE[t].label}
            </span>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <SectionLabel>Snapshot</SectionLabel>
          <Link to="/athlete/$tab" params={{ tab: 'performance' }} className="text-[13px]">
            Athlete
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile label="FTP (Zwift)" value={data.snapshot.ftpZwift} unit="W" />
          <StatTile label="W/kg" value={data.snapshot.wattsPerKg.toFixed(2)} />
          <StatTile label="Best 5 min" value={data.snapshot.best5minW ?? '—'} {...(data.snapshot.best5minW ? { unit: 'W' } : {})} />
          <div className="rounded-[10px] bg-surface-2 p-2.5" title="Median of the last 7 days of weigh-ins">
            <div className="text-xs text-muted">Weight (trend)</div>
            <div className="font-mono text-xl font-semibold">
              {data.snapshot.weightKg}
              <span className="text-xs text-muted"> kg</span>
            </div>
            {data.snapshot.weightLatest && data.snapshot.weightLatest.kg !== data.snapshot.weightKg && (
              <div className="font-mono text-[11px] text-faint">last {data.snapshot.weightLatest.kg} kg</div>
            )}
          </div>
          {data.snapshot.fitness && (
            <>
              <StatTile label="Fitness (CTL)" value={Math.round(data.snapshot.fitness.ctl)} />
              <StatTile
                label="Form (TSB)"
                value={`${data.snapshot.fitness.form >= 0 ? '+' : ''}${Math.round(data.snapshot.fitness.form)}`}
              />
            </>
          )}
        </div>
        <ZwiftWeightAlert zwiftKg={data.snapshot.zwiftWeightKg} trendKg={data.snapshot.weightKg} synced={data.snapshot.zwiftWeightSynced} compact />
      </Card>

      {goal && (
        <Card className="flex flex-col gap-2.5 p-4">
          <div className="flex items-center justify-between">
            <SectionLabel>Main goal</SectionLabel>
            <Link to="/athlete/$tab" params={{ tab: 'goals' }} className="text-[13px]">
              Goals
            </Link>
          </div>
          <div className="font-semibold">{goal.title}</div>
          {goal.progress ? (
            <>
              <ProgressBar value={goal.progress.fraction} />
              <div className="flex justify-between font-mono text-xs text-muted">
                <span>
                  {goal.progress.current} {goal.progress.unit} now
                </span>
                <span>{goal.progress.target} target</span>
              </div>
              <div className="text-[11px] text-faint">{goal.progress.label}</div>
            </>
          ) : (
            goal.detail && <div className="text-[13px] text-muted">{goal.detail}</div>
          )}
        </Card>
      )}
    </aside>
  );
}
