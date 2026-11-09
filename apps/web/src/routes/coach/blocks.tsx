import {
  describeMainSet,
  describeTargets,
  formatDayLabel,
  formatLongDay,
  formatWorkoutDuration,
  isTimeOffChange,
  paceLabel,
  previewCalendarChange,
  workoutMetrics,
  type ChangePreview,
  type PreviewField,
  type SessionPreview,
} from '@cycling-coach/core';
import { EVENT_AIM_LABEL, EVENT_WEIGHT_LABEL, TIME_OFF_LABEL, TRAINING_APPROACH_LABEL, TRAINING_PREFERENCE_LABEL, type CalendarChange, type Proposal, type ProposalItemStatus, type TimeOffChange, type ToolChipBlock, type UiBlock, type Workout } from '@cycling-coach/shared';
import { createContext, memo, useContext, useState } from 'react';
import { Link } from '@tanstack/react-router';
import ReactMarkdown from 'react-markdown';
import { CalendarAddIcon, CheckIcon, ChevronDown, LogoIcon, MemoryIcon, PlusIcon, PulseIcon, WarningIcon, XIcon } from '../../components/icons';
import { Button, Card, ErrorNote, SessionTag } from '../../components/ui';
import { ScheduleControl } from '../../components/ScheduleControl';
import { ZoneChart } from '../../components/ZoneChart';
import { downloadZwo } from '../../lib/api';
import { describeMeasure, goalDateLabel, measureUnit } from '../../lib/goals';
import { durationText, kindLabel, SESSION_STYLE, TIME_OFF_STYLE, timeOffDates } from '../../lib/session';
import {
  errorMessage,
  useDashboard,
  useOutlookMutations,
  useProfileMutations,
  useProposal,
  useProposalMutations,
  useWorkout,
} from '../../lib/queries';

export const TextBlock = memo(function TextBlock({ text }: { text: string }) {
  return (
    <div className="prose-coach">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
});

/** Beside a button's label while it works (DESIGN 15). Applying a plan can take a while: each synced session is a request. */
function BusyRing() {
  return <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />;
}

/** "Pulled 16 rides · Oct 20 – 28 · 5 races, 10.1 h", expandable to the rows. */
export function ToolChip({ block }: { block: ToolChipBlock }) {
  const [open, setOpen] = useState(false);
  const running = block.status === 'running';
  const expandable = block.status === 'ok' && !!block.rows?.length;
  return (
    <div className="flex flex-col gap-2 self-start">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className="flex min-h-10 items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3.5 text-left text-[13px] text-muted mobile:min-h-[44px]"
      >
        <PulseIcon className={block.source === 'data' ? 'shrink-0 text-data' : 'shrink-0 text-muted'} />
        <span className={running ? 'animate-pulse' : ''}>
          {block.status === 'error' ? <span className="text-danger">{block.summary}</span> : block.summary}
        </span>
        {expandable && <ChevronDown className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && block.rows && (
        <div className="max-h-64 overflow-auto rounded-[10px] border border-line bg-surface-alt px-3.5 py-2 font-mono text-xs text-muted">
          {block.rows.map((r, i) => (
            <div key={i} className="border-b border-divider py-1 last:border-0">
              {r}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusButton({
  status,
  label,
  onAdd,
  busy,
}: {
  status: ProposalItemStatus;
  label: string;
  onAdd: () => void;
  busy: boolean;
}) {
  if (status === 'applied') {
    return (
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-accent-tint-2 text-success mobile:h-[44px] mobile:w-[44px]" aria-label="Added">
        <CheckIcon />
      </span>
    );
  }
  if (status === 'dismissed') return <span className="w-9 flex-none text-center text-xs text-faint mobile:w-[44px]">—</span>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onAdd}
      disabled={busy}
      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line-strong bg-transparent text-ink mobile:h-[44px] mobile:w-[44px] mobile:border-0"
    >
      <PlusIcon />
    </button>
  );
}

const COLLAPSED_ROWS = 8;

function PlanCard({ proposal, threadId }: { proposal: Extract<Proposal, { kind: 'plan' }>; threadId: string }) {
  const { apply } = useProposalMutations(threadId);
  const [expanded, setExpanded] = useState(false);
  const pending = proposal.itemStatus.filter((s) => s === 'pending').length;
  const rows = expanded ? proposal.items : proposal.items.slice(0, COLLAPSED_ROWS);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3.5">
        <div>
          <div className="font-semibold">{proposal.title}</div>
          {proposal.subtitle && <div className="text-xs text-muted">{proposal.subtitle}</div>}
        </div>
        <Button variant="primary" disabled={pending === 0 || apply.isPending} onClick={() => apply.mutate({ id: proposal.id })}>
          {apply.isPending ? <BusyRing /> : <CalendarAddIcon />}
          {apply.isPending ? 'Adding…' : pending === 0 ? 'On your calendar' : <>Add all<span className="mobile:hidden"> to calendar</span></>}
        </Button>
      </div>
      {/* Mobile rows are compact: colour bar, title, "day · duration", a 44px "+". */}
      {rows.map((item, i) => (
        <div
          key={i}
          className={`flex items-center gap-3.5 border-b border-divider px-4 py-2.5 mobile:gap-2.5 mobile:py-2 mobile:pr-1.5 mobile:pl-3.5 ${proposal.itemStatus[i] === 'dismissed' ? 'opacity-50' : ''}`}
        >
          <span className="hidden w-1 flex-none self-stretch rounded-sm mobile:block" style={{ background: SESSION_STYLE[item.type].dot }} />
          <div className="w-16 flex-none font-mono text-xs text-muted mobile:hidden">{formatDayLabel(item.date)}</div>
          <div className="w-[86px] flex-none mobile:hidden">
            <SessionTag type={item.type} tentative={item.tentative} />
          </div>
          <div className="min-w-0 flex-auto">
            <div className="mobile:truncate mobile:text-[13px] mobile:font-semibold">{item.title}</div>
            <div className="hidden font-mono text-[11px] text-muted mobile:block">{[formatDayLabel(item.date), durationText(item)].filter(Boolean).join(' · ')}</div>
            {(item.kind !== 'ride' || item.startTime) && <div className="text-xs font-medium text-muted mobile:hidden">{kindLabel(item)}</div>}
            {item.coachNote && <div className="text-xs text-muted mobile:hidden">{item.coachNote}</div>}
          </div>
          <div className="w-[70px] flex-none text-right font-mono text-xs text-muted mobile:hidden">{durationText(item)}</div>
          <StatusButton
            status={proposal.itemStatus[i] ?? 'pending'}
            label={`Add ${formatDayLabel(item.date)} to calendar`}
            busy={apply.isPending}
            onAdd={() => apply.mutate({ id: proposal.id, indexes: [i] })}
          />
        </div>
      ))}
      {proposal.items.length > COLLAPSED_ROWS && (
        <div className="px-4 py-2.5 text-[13px]">
          <button type="button" className="border-0 bg-transparent p-0 text-accent-ink" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Show fewer' : `Show ${proposal.items.length - COLLAPSED_ROWS} more days`}
          </button>
        </div>
      )}
      {apply.error && (
        <div className="px-4 pb-3">
          <ErrorNote>{errorMessage(apply.error)}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

const OP_MARK: Record<CalendarChange['op'], string> = { add: '+', move: '→', update: '~', remove: '−' };

const FIELD_LABEL: Record<PreviewField, string> = {
  date: 'Date',
  title: 'Title',
  type: 'Type',
  kind: 'Kind',
  duration: 'Duration',
  startTime: 'Start',
  priority: 'Priority',
  workoutId: 'Workout',
  tentative: 'Tentative',
  meta: 'Details',
  coachNote: 'Note',
};

function fieldText(e: SessionPreview, f: PreviewField): string {
  switch (f) {
    case 'date':
      return formatLongDay(e.date);
    case 'duration':
      return durationText(e) || '—';
    case 'tentative':
      return e.tentative ? 'yes' : 'no';
    case 'type':
      return SESSION_STYLE[e.type].label;
    default:
      return e[f] ?? '—';
  }
}

/** The fields an update or move changes, as "Duration 73m → 60m". Workout and note swaps show when expanded. */
function changeSummary(p: ChangePreview): string {
  if (!p.before || !p.after) return '';
  return p.changed
    .filter((f) => f !== 'workoutId' && f !== 'coachNote' && f !== 'meta' && f !== 'title')
    .map((f) => `${FIELD_LABEL[f]} ${fieldText(p.before!, f)} → ${fieldText(p.after!, f)}`)
    .concat(p.changed.includes('workoutId') ? ['new workout'] : [])
    .join(' · ');
}

/** A library workout's profile and main set, compact, for a change row. */
function WorkoutPreview({ id, label }: { id: string; label?: string | undefined }) {
  const { data: workout } = useWorkout(id);
  if (!workout) return <div className="h-10 animate-pulse rounded bg-surface-2" />;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-muted">
        {label ? `${label}: ` : ''}
        <span className="font-medium text-ink">{workout.name}</span> · {describeMainSet(workout.segments)} ·{' '}
        {formatWorkoutDuration(workoutMetrics(workout.segments).totalSec)}
      </div>
      <ZoneChart segments={workout.segments} height={40} />
    </div>
  );
}

function ChangeDetail({ preview }: { preview: ChangePreview }) {
  const { before, after, changed } = preview;
  const oldWorkout = before?.workoutId;
  const newWorkout = after?.workoutId;
  const workoutChanged = !!before && !!after && changed.includes('workoutId');
  const textChanges = before && after ? changed.filter((f) => f === 'title' || f === 'meta' || f === 'coachNote') : [];
  const note = after?.coachNote ?? before?.coachNote;
  return (
    <div className="flex flex-col gap-2.5 bg-surface-alt px-4 py-3 text-[13px]">
      {textChanges.map((f) => (
        <div key={f}>
          <span className="text-muted">{FIELD_LABEL[f]}: </span>
          <span className="text-muted line-through">{fieldText(before!, f)}</span> → {fieldText(after!, f)}
        </div>
      ))}
      {workoutChanged && oldWorkout && <WorkoutPreview id={oldWorkout} label="Was" />}
      {newWorkout && <WorkoutPreview id={newWorkout} label={workoutChanged ? 'Now' : undefined} />}
      {!newWorkout && oldWorkout && !after && <WorkoutPreview id={oldWorkout} />}
      {note && !textChanges.includes('coachNote') && <div className="text-muted">{note}</div>}
      {after && !newWorkout && !oldWorkout && !note && !textChanges.length && (
        <div className="text-muted">{after.meta ?? kindLabel(after)}</div>
      )}
    </div>
  );
}

function ChangeRow({
  change,
  preview,
  status,
  busy,
  onApply,
  onSkip,
}: {
  change: CalendarChange;
  preview: ChangePreview;
  status: ProposalItemStatus;
  busy: boolean;
  onApply: () => void;
  onSkip: () => void;
}) {
  const [open, setOpen] = useState(false);
  const session = preview.after ?? preview.before;
  const removed = change.op === 'remove';
  // No session means a card stored before snapshots existed: its title already says it all.
  const sub = preview.missing
    ? 'Session not found — this change will fail'
    : !session
      ? ''
      : change.op === 'move'
        ? `Moved from ${formatLongDay((preview.before ?? session).date)}`
        : change.op === 'update'
          ? changeSummary(preview) || 'Details only'
          : change.op === 'add'
            ? kindLabel(session)
            : 'Removed from your calendar';
  const expandable = !!session && !preview.missing;
  return (
    <div className={`border-b border-divider last:border-0 ${status === 'dismissed' ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => expandable && setOpen((o) => !o)}
          aria-expanded={expandable ? open : undefined}
          className="flex min-w-0 flex-auto items-center gap-3 border-0 bg-transparent p-0 text-left text-ink"
        >
          <span className="w-3 flex-none text-center font-mono text-muted" aria-label={change.op}>
            {OP_MARK[change.op]}
          </span>
          <span className="w-14 flex-none font-mono text-xs text-muted">{session ? formatDayLabel(session.date) : '—'}</span>
          <span className="w-[86px] flex-none">{session && <SessionTag type={session.type} tentative={session.tentative} />}</span>
          <span className="min-w-0 flex-auto">
            <span className={removed ? 'line-through' : ''}>{session?.title ?? describeFallback(change)}</span>
            {sub && <span className={`block text-xs ${preview.missing ? 'text-danger' : 'text-muted'}`}>{sub}</span>}
          </span>
          <span className="w-[54px] flex-none text-right font-mono text-xs text-muted">{session ? durationText(session) : ''}</span>
          {expandable && <ChevronDown className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />}
        </button>
        <RowControls status={status} busy={busy} onApply={onApply} onSkip={onSkip} />
      </div>
      {open && <ChangeDetail preview={preview} />}
    </div>
  );
}

function RowControls({ status, busy, onApply, onSkip }: { status: ProposalItemStatus; busy: boolean; onApply: () => void; onSkip: () => void }) {
  return (
    <>
      {status === 'pending' && (
        <button
          type="button"
          aria-label="Skip this change"
          onClick={onSkip}
          disabled={busy}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted"
        >
          <XIcon />
        </button>
      )}
      <StatusButton status={status} label="Apply this change" busy={busy} onAdd={onApply} />
    </>
  );
}

const TIME_OFF_MARK: Record<TimeOffChange['op'], string> = { time_off_add: '+', time_off_update: '~', time_off_remove: '−' };

/** Vacation or sick days on a change card: the kind, the dates, and what they were if they're changing. */
function TimeOffChangeRow({
  change,
  status,
  busy,
  onApply,
  onSkip,
}: {
  change: TimeOffChange;
  status: ProposalItemStatus;
  busy: boolean;
  onApply: () => void;
  onSkip: () => void;
}) {
  const entry = change.op === 'time_off_remove' ? change.was : change.entry;
  const removed = change.op === 'time_off_remove';
  const s = TIME_OFF_STYLE[entry.kind];
  const sub = removed ? 'Removed from your calendar' : change.op === 'time_off_update' ? `Was ${timeOffDates(change.was)}` : entry.note;
  return (
    <div className={`border-b border-divider last:border-0 ${status === 'dismissed' ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="w-3 flex-none text-center font-mono text-muted" aria-label={change.op}>
          {TIME_OFF_MARK[change.op]}
        </span>
        <span className="flex-none rounded-md px-2 py-0.5 text-xs font-semibold" style={{ color: s.fg, background: s.bg }}>
          {TIME_OFF_LABEL[entry.kind]}
        </span>
        <span className="min-w-0 flex-auto">
          <span className={removed ? 'line-through' : ''}>{timeOffDates(entry)}</span>
          {sub && <span className="block text-xs text-muted">{sub}</span>}
        </span>
        <RowControls status={status} busy={busy} onApply={onApply} onSkip={onSkip} />
      </div>
    </div>
  );
}

/** For proposals stored before "before" snapshots existed. */
function describeFallback(change: CalendarChange): string {
  switch (change.op) {
    case 'add':
      return change.event.title;
    case 'move':
      return `Move session to ${formatLongDay(change.toDate)}`;
    case 'update':
      return `Update session${change.patch.title ? `: ${change.patch.title}` : ''}`;
    case 'remove':
      return 'Remove session';
  }
}

/** Opens the composer to ask the coach for a revised card. Provided by the chat page. */
export const RequestChangesContext = createContext<((title: string) => void) | null>(null);

function ChangesCard({ proposal, threadId }: { proposal: Extract<Proposal, { kind: 'calendar_changes' }>; threadId: string }) {
  const { apply, dismiss } = useProposalMutations(threadId);
  const requestChanges = useContext(RequestChangesContext);
  const pending = proposal.itemStatus.some((s) => s === 'pending');
  const busy = apply.isPending || dismiss.isPending;
  const previews = proposal.items.map((change, i) => previewCalendarChange(change, proposal.before ? proposal.before[i] : undefined));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3.5">
        <div className="font-semibold">{proposal.title}</div>
        {pending ? (
          <div className="flex flex-wrap gap-2">
            {requestChanges && (
              <Button size="sm" variant="ghost" onClick={() => requestChanges(proposal.title)}>
                Request changes
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => dismiss.mutate({ id: proposal.id })}>
              Dismiss
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => apply.mutate({ id: proposal.id })}>
              {apply.isPending ? <><BusyRing />Applying…</> : 'Apply all'}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted">
            {proposal.itemStatus.some((s) => s === 'applied') ? 'Applied' : 'Dismissed'}
          </span>
        )}
      </div>
      {proposal.items.map((change, i) => {
        const row = {
          status: proposal.itemStatus[i] ?? ('pending' as const),
          busy,
          onApply: () => apply.mutate({ id: proposal.id, indexes: [i] }),
          onSkip: () => dismiss.mutate({ id: proposal.id, indexes: [i] }),
        };
        return isTimeOffChange(change) ? <TimeOffChangeRow key={i} change={change} {...row} /> : <ChangeRow key={i} change={change} preview={previews[i]!} {...row} />;
      })}
      {apply.data?.failed.length ? (
        <div className="px-4 pb-3">
          <ErrorNote>{apply.data.failed.length} change(s) referred to something that no longer exists.</ErrorNote>
        </div>
      ) : null}
      {(apply.error || dismiss.error) && (
        <div className="px-4 pb-3">
          <ErrorNote>{errorMessage(apply.error ?? dismiss.error)}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

function ProfileUpdateCard({ proposal, threadId }: { proposal: Extract<Proposal, { kind: 'profile_update' }>; threadId: string }) {
  const { apply, dismiss } = useProposalMutations(threadId);
  const u = proposal.items[0]!;
  const status = proposal.itemStatus[0];
  const lines = [
    u.ftpZwift && `FTP → ${u.ftpZwift} W`,
    u.zwiftWeightKg && `Zwift weight → ${u.zwiftWeightKg} kg`,
    u.trainingPreference && `Training preference → ${TRAINING_PREFERENCE_LABEL[u.trainingPreference]}`,
    u.trainingApproach && `Training approach → ${TRAINING_APPROACH_LABEL[u.trainingApproach]}`,
    ...(u.powerBests ?? []).map((b) => `${b.durationSec < 60 ? `${b.durationSec} s` : `${b.durationSec / 60} min`} best → ${b.watts} W`),
  ].filter(Boolean);
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="font-semibold">{lines.length === 1 && u.trainingPreference ? 'Change your training preference?' : lines.length === 1 && u.trainingApproach ? 'Change your training approach?' : 'Update your numbers?'}</div>
      <ul className="m-0 pl-5 text-[13px]">
        {lines.map((l) => (
          <li key={l as string}>{l}</li>
        ))}
      </ul>
      {u.reason && <div className="text-xs text-muted">{u.reason}</div>}
      <div className="flex gap-2">
        {status === 'pending' ? (
          <>
            <Button variant="primary" size="sm" disabled={apply.isPending} onClick={() => apply.mutate({ id: proposal.id })}>
              {apply.isPending ? <><BusyRing />Updating…</> : 'Update profile'}
            </Button>
            <Button size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate({ id: proposal.id })}>
              Not now
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted">{status === 'applied' ? 'Profile updated.' : 'Dismissed.'}</span>
        )}
      </div>
    </Card>
  );
}

function GoalCard({ proposal, threadId }: { proposal: Extract<Proposal, { kind: 'goal' }>; threadId: string }) {
  const { apply, dismiss } = useProposalMutations(threadId);
  const g = proposal.items[0]!;
  const status = proposal.itemStatus[0];
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
        {g.goalId ? 'Update goal' : 'New goal'} · {g.horizon === 'long' ? 'long term' : 'short term'}
        {goalDateLabel(g) ? ` · ${goalDateLabel(g)}` : ''}
      </div>
      <div className="font-semibold">{g.title}</div>
      {/* A goal for an event on the calendar: how much it counts (DECISIONS #100). */}
      {g.eventId && (
        <div className="text-[13px] text-muted">
          For an event on your calendar · {EVENT_WEIGHT_LABEL[g.primary ? 'main' : (g.weight ?? 'important')]}
          {g.aim ? ` · Aim: ${EVENT_AIM_LABEL[g.aim]}` : ''}
        </div>
      )}
      {g.detail && <div className="text-[13px] text-muted">{g.detail}</div>}
      {g.measure && g.target !== undefined && (
        <div className="font-mono text-[13px]">
          {describeMeasure(g.measure)} → {g.target} {measureUnit(g.measure)}
          {g.measure.kind === 'weight' && g.pace ? ` at ${paceLabel(g.pace)}` : ''}
        </div>
      )}
      <div className="flex gap-2">
        {status === 'pending' ? (
          <>
            <Button variant="primary" size="sm" disabled={apply.isPending} onClick={() => apply.mutate({ id: proposal.id })}>
              {apply.isPending ? <><BusyRing />Saving…</> : g.goalId ? 'Update goal' : 'Add goal'}
            </Button>
            <Button size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate({ id: proposal.id })}>
              Not now
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted">{status === 'applied' ? 'Saved to your goals.' : 'Dismissed.'}</span>
        )}
      </div>
    </Card>
  );
}

export function ProposalBlock({ id, threadId, initial }: { id: string; threadId: string; initial?: Proposal | undefined }) {
  const { data, error } = useProposal(id, initial);
  if (error) return <ErrorNote>{errorMessage(error)}</ErrorNote>;
  if (!data) return <Card className="h-24 animate-pulse">{null}</Card>;
  switch (data.kind) {
    case 'plan':
      return <PlanCard proposal={data} threadId={threadId} />;
    case 'calendar_changes':
      return <ChangesCard proposal={data} threadId={threadId} />;
    case 'profile_update':
      return <ProfileUpdateCard proposal={data} threadId={threadId} />;
    case 'goal':
      return <GoalCard proposal={data} threadId={threadId} />;
  }
}

/** Workout card: summary line, profile chart, Download .zwo, Schedule. */
export function WorkoutCard({ workout }: { workout: Workout }) {
  const { data: dashboard } = useDashboard();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const ftp = dashboard?.snapshot.ftpZwift;
  const { totalSec } = workoutMetrics(workout.segments);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{workout.name}</div>
          <div className="text-xs text-muted">
            {describeMainSet(workout.segments)} · {formatWorkoutDuration(totalSec)}
            {ftp ? ` · ${describeTargets(workout.segments, ftp)}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => downloadZwo(workout.id).catch((e) => setDownloadError(errorMessage(e)))}
          >
            Download .zwo
          </Button>
          <ScheduleControl workout={workout} today={dashboard?.today} />
        </div>
      </div>
      <ZoneChart segments={workout.segments} />
      {workout.description && <div className="text-[13px] text-muted">{workout.description}</div>}
      {downloadError && <ErrorNote>{downloadError}</ErrorNote>}
    </Card>
  );
}

export function WorkoutBlock({ id, initial }: { id: string; initial?: Workout | undefined }) {
  const { data } = useWorkout(id, !initial);
  const workout = initial ?? data;
  if (!workout) return <Card className="h-28 animate-pulse">{null}</Card>;
  return <WorkoutCard workout={workout} />;
}

/** What the chip says a note became. Chips stored before DECISIONS #79 have no date and were long-term. */
function memoryChipLabel(block: Extract<UiBlock, { type: 'memory' }>): string {
  if (block.action === 'forget') return 'Forgot: ';
  const when = block.until ? ` until ${formatLongDay(block.until)}` : '';
  if (block.action === 'update') return block.until ? `Updated (${when.trim()}): ` : 'Updated long-term memory: ';
  return block.until ? `Remembering${when}: ` : 'Saved to long-term memory: ';
}

export function MemoryChip({ block }: { block: Extract<UiBlock, { type: 'memory' }> }) {
  const { deleteMemory, restoreMemory, revertMemory } = useProfileMutations();
  const [undone, setUndone] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const undo = () => {
    const onSuccess = () => setUndone(true);
    if (block.action === 'remember') deleteMemory.mutate(block.memoryId, { onSuccess });
    else if (block.action === 'forget') restoreMemory.mutate(block.memoryId, { onSuccess });
    else if (block.previous) {
      revertMemory.mutate(
        { id: block.memoryId, from: { text: block.text, ...(block.until ? { until: block.until } : {}) }, to: block.previous },
        { onSuccess, onError: (err) => setRefused(errorMessage(err)) },
      );
    }
  };
  return (
    <div className="flex items-center gap-2 self-start rounded-[10px] border border-accent-line bg-accent-tint px-3 py-2 text-[13px]">
      <MemoryIcon className="shrink-0 text-accent-ink" />
      <span>
        {undone ? 'Undone: ' : refused ? 'Couldn’t undo: ' : memoryChipLabel(block)}
        <span className="text-muted">{refused ?? block.text}</span>
      </span>
      {!undone && !refused && (
        <button type="button" onClick={undo} className="ml-1 border-0 bg-transparent p-0 text-[13px] text-accent-ink">
          Undo
        </button>
      )}
    </div>
  );
}

/**
 * The coach rewrote its outlook (DECISIONS #101). Undo puts back what it said before, unless it has
 * changed since (the athlete edited it), which the chip says instead of overwriting.
 */
export function OutlookChip({ block }: { block: Extract<UiBlock, { type: 'outlook' }> }) {
  const { revert } = useOutlookMutations();
  const [state, setState] = useState<'shown' | 'undone' | 'refused'>('shown');
  const [open, setOpen] = useState(false);
  const long = block.text.length > 140;
  const toOutlook = (
    <Link to="/athlete/$tab" params={{ tab: 'goals' }} className="text-[13px] font-semibold whitespace-nowrap">
      View outlook
    </Link>
  );
  if (state === 'undone') {
    return (
      <div role="status" className="flex items-center gap-2.5 self-start rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-muted">
        <LogoIcon size={16} className="shrink-0" />
        <span>
          <strong className="font-semibold text-ink">Undone.</strong> The outlook is back to what it said before.
        </span>
      </div>
    );
  }
  if (state === 'refused') {
    return (
      <div role="status" className="flex items-center gap-2.5 self-start rounded-xl border border-[#F3D58A] bg-[#FFF8E6] px-3 py-2.5 text-sm text-[#7A4B00]">
        <WarningIcon size={16} className="shrink-0" />
        <span className="flex-auto">Couldn’t undo: the outlook has changed since.</span>
        {toOutlook}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-accent-line bg-accent-tint px-3 py-2.5 text-sm">
      <LogoIcon size={16} className="mt-0.5 shrink-0 text-accent-ink" />
      <div className="flex min-w-0 flex-auto flex-col gap-0.5">
        <div className={open || !long ? '' : 'line-clamp-2'}>
          <strong className="font-semibold">Updated the outlook:</strong> {block.text}
        </div>
        <div className="flex gap-3">
          {long && (
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="min-h-7 border-0 bg-transparent p-0 text-[13px] font-semibold text-accent-ink">
              {open ? 'Show less' : 'Show all'}
            </button>
          )}
          {toOutlook}
        </div>
      </div>
      <button
        type="button"
        disabled={revert.isPending}
        onClick={() => revert.mutate({ from: block.text, to: block.previous ?? null }, { onSuccess: () => setState('undone'), onError: () => setState('refused') })}
        className="min-h-8 flex-none rounded-lg border border-[#C9DB94] bg-surface px-3 text-[13px] font-semibold text-ink"
      >
        Undo
      </button>
    </div>
  );
}
