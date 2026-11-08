import { canDeleteSession, describeMainSet, sessionState, formatLongDay, formatStepDuration, formatWorkoutDuration, workoutMetrics } from '@cycling-coach/core';
import {
  sessionTypes,
  type CalendarActivity,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventPatch,
  type ClearableEventField,
  type SessionFeedback,
  type SessionKind,
  type SessionType,
  type TimeOff,
  type Workout,
} from '@cycling-coach/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { FeedbackCard } from '../../components/FeedbackCard';
import { MissedNoteCard } from '../../components/MissedNoteCard';
import { CheckIcon, PulseIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { Button, ErrorNote, SectionLabel, SessionTag, StatTile, Tag } from '../../components/ui';
import { ZoneChart } from '../../components/ZoneChart';
import { downloadZwo } from '../../lib/api';
import { errorMessage, useCalendarMutations, useIntervals, useWorkout, useWorkouts } from '../../lib/queries';
import { SESSION_STYLE, durationText, kindLabel, sessionTypeFor } from '../../lib/session';
import { CompletedPanel } from './completed';
import { AddRideFromDay, AddToSession } from './grouping';
import { askCoachPrompt, intervalsUrl, PANEL, rideName } from './shared';

/**
 * The calendar's session, ride and add-session panels. Desktop shows them beside the grid; on
 * mobile (`sheet`) the same content sits in a bottom sheet.
 */
export type Selection =
  | { type: 'event'; id: string }
  | { type: 'activity'; id: string }
  | { type: 'add'; date: string }
  | { type: 'time-off-add'; date: string }
  | { type: 'time-off'; entry: TimeOff }
  | null;


export function syncState(e: CalendarEvent): 'synced' | 'failed' | 'pending' | null {
  if (e.kind === 'ride' && !e.intervals) return null;
  if (e.intervals?.error || e.syncError) return 'failed';
  return e.intervals ? 'synced' : 'pending';
}

export function RideSummary({ activity }: { activity: CalendarActivity }) {
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <PulseIcon className="shrink-0 text-data" /> <span className="truncate">{activity.name}</span>
        </span>
        {activity.provider ? (
          <span className="shrink-0 text-xs text-muted">{activity.sourceLabel}</span>
        ) : (
          <a href={intervalsUrl(activity.id)} target="_blank" rel="noreferrer" className="shrink-0 text-xs">
            intervals.icu
          </a>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Time" value={formatWorkoutDuration(activity.movingSec)} />
        <StatTile label="NP" value={activity.normalizedWatts ?? '—'} {...(activity.normalizedWatts ? { unit: 'W' } : {})} />
        <StatTile label="Load" value={activity.trainingLoad ?? '—'} />
      </div>
      {activity.intensityPct ? <div className="text-muted">IF {(activity.intensityPct / 100).toFixed(2)}</div> : null}
      {activity.intervalSummary?.length ? <div className="font-mono text-xs text-muted">{activity.intervalSummary.join(' · ')}</div> : null}
    </div>
  );
}

export function ActivityPanel({
  activity,
  feedback,
  sessions,
  onAdded,
  onClose,
  sheet = false,
}: {
  activity: CalendarActivity;
  feedback: SessionFeedback | undefined;
  /** That day's sessions, which the ride can be grouped into. */
  sessions: readonly CalendarEvent[];
  /** The ride joined a session — show that session. */
  onAdded?: (eventId: string) => void;
  onClose: () => void;
  sheet?: boolean;
}) {
  const navigate = useNavigate();
  const name = rideName(activity);
  const date = activity.startLocal.slice(0, 10);
  const body = (
    <>
      <RideSummary activity={activity} />
      <AddToSession activity={activity} sessions={sessions} onAdded={onAdded} />
      <FeedbackCard target={{ activityId: activity.id }} feedback={feedback} />
      <Button size="lg" onClick={() => void navigate({ to: '/', search: { new: true, prompt: askCoachPrompt(name, date, `ride ${activity.id}`) } })}>
        Ask coach about this ride
      </Button>
    </>
  );
  if (sheet) {
    return (
      <Sheet tall eyebrow={`${formatLongDay(date)} · ridden · not planned`} title={name} onClose={onClose}>
        {body}
      </Sheet>
    );
  }
  return (
    <aside aria-label="Selected ride" className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <SectionLabel>{formatLongDay(date)} · ridden · not planned</SectionLabel>
          <h2 className="mt-1 mb-0 text-[22px]">{name}</h2>
        </div>
        <button type="button" onClick={onClose} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>
      {body}
    </aside>
  );
}

function SyncRow({ event }: { event: CalendarEvent }) {
  const intervals = useIntervals();
  const { resync } = useCalendarMutations();
  const state = syncState(event);
  if (!state || intervals.data?.status !== 'connected') return null;
  const error = event.intervals?.error ?? event.syncError;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
      {state === 'synced' ? (
        <span className="flex items-center gap-1.5 text-success">
          <CheckIcon /> On intervals.icu
          {event.kind === 'workout' && event.platform !== 'garmin' && intervals.data.zwiftConnected ? ' → Zwift' : ''}
        </span>
      ) : (
        <span className="text-danger">{state === 'failed' ? `Not synced: ${error}` : 'Not synced yet'}</span>
      )}
      {state !== 'synced' && (
        <Button size="sm" variant="ghost" disabled={resync.isPending} onClick={() => resync.mutate(event.id)}>
          {resync.isPending ? 'Syncing…' : 'Retry sync'}
        </Button>
      )}
    </div>
  );
}

type DetailProps = {
  event: CalendarEvent;
  /** The session's rides, by start: the matched one plus any grouped into it. */
  rides: CalendarActivity[];
  /** That day's rides no session claimed — they can be grouped into this one. */
  dayRides: CalendarActivity[];
  feedback: SessionFeedback | undefined;
  onClose: () => void;
  sheet?: boolean;
};

/** A session's panel: the completed layout once it's done, the planned one before. */
export function DetailPanel(props: DetailProps) {
  return sessionState(props.event) === 'completed' ? <CompletedPanel {...props} /> : <PlannedPanel key={props.event.id} {...props} />;
}

type RacePriority = 'A' | 'B' | 'C';

function PlannedPanel({ event, rides, dayRides, feedback, onClose, sheet = false }: DetailProps) {
  const navigate = useNavigate();
  const { patch, remove } = useCalendarMutations();
  const workout = useWorkout(event.workoutId ?? '', !!event.workoutId);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metrics = workout.data ? workoutMetrics(workout.data.segments) : null;

  const eyebrow = `${formatLongDay(event.date)} · ${event.status}${event.source === 'intervals' ? ' · from intervals.icu' : ''}`;
  const tags = (
    <div className="flex flex-wrap items-center gap-1.5">
      <SessionTag type={event.type} tentative={event.tentative} />
      <span className="text-xs font-medium text-muted">{kindLabel(event)}</span>
      {durationText(event) && <span className="font-mono text-xs text-muted">{durationText(event)}</span>}
    </div>
  );
  const details = (
    <>
      {event.meta && <div className="text-[13px] text-muted">{event.meta}</div>}
      <SyncRow event={event} />
      {(event.status === 'missed' || event.status === 'skipped') && <MissedNoteCard key={event.id} eventId={event.id} feedback={feedback} />}
      {rides[0] && <RideSummary activity={rides[0]} />}
      <AddRideFromDay event={event} rides={dayRides} title="Add a ride from this day" />

      {workout.data && metrics && (
        <>
          <ZoneChart segments={workout.data.segments} height={96} />
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Duration" value={formatWorkoutDuration(metrics.totalSec)} />
            <StatTile label="Work" value={formatStepDuration(metrics.workSec)} />
            <StatTile label="Rest" value={formatStepDuration(metrics.restSec)} />
          </div>
          <div className="text-[13px]">{describeMainSet(workout.data.segments)}</div>
        </>
      )}

      {event.coachNote && (
        <div className="rounded-[10px] border border-accent-line bg-accent-tint-2 p-3 text-[13px] whitespace-pre-wrap">
          <div className="mb-1 text-xs font-semibold text-accent-ink">{event.source === 'coach' ? 'Coach note' : 'Notes'}</div>
          {event.coachNote}
        </div>
      )}
    </>
  );

  const zwo = () => downloadZwo(event.workoutId!).catch((e) => setError(errorMessage(e)));
  const toggleDone = () => patch.mutate({ id: event.id, patch: { status: event.status === 'done' ? 'planned' : 'done' } });
  const askCoach = () =>
    void navigate({
      to: '/',
      search: { new: true, prompt: `About my ${event.title} on ${formatLongDay(event.date)} (event ${event.id}): ` },
    });
  const deleteControl =
    canDeleteSession(event) &&
    (confirmDelete ? (
      <span className="col-span-2 flex gap-2">
        <Button size="lg" variant="ghost" className="flex-1" onClick={() => setConfirmDelete(false)}>
          Keep
        </Button>
        <Button
          size="lg"
          variant="primary"
          className="flex-1"
          style={{ background: '#B42318', borderColor: '#B42318' }}
          disabled={remove.isPending}
          onClick={() => remove.mutate(event.id, { onSuccess: onClose })}
        >
          {remove.isPending ? 'Deleting…' : event.intervals ? 'Delete here and on intervals.icu' : 'Delete'}
        </Button>
      </span>
    ) : (
      <Button size="lg" variant="ghost" style={{ color: '#B42318' }} onClick={() => setConfirmDelete(true)}>
        Delete…
      </Button>
    ));
  const errors = (
    <>
      {(error || patch.error || remove.error) && <ErrorNote>{error ?? errorMessage(patch.error ?? remove.error)}</ErrorNote>}
      {patch.data?.syncError && <ErrorNote>Saved here, but intervals.icu didn’t update yet: {patch.data.syncError}. It’ll retry.</ErrorNote>}
    </>
  );

  if (editing) return <EditPanel event={event} sheet={sheet} onDone={() => setEditing(false)} />;

  if (sheet) {
    // MobileSession: Edit · .zwo · Mark done in a sticky footer; asking the coach and deleting sit in the body.
    const big = 'min-h-[48px]! rounded-xl';
    return (
      <Sheet
        tall
        eyebrow={eyebrow}
        title={event.title}
        header={<div className="mt-1.5">{tags}</div>}
        onClose={onClose}
        footer={
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            <Button size="lg" variant="ghost" className={big} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {event.workoutId && (
              <Button size="lg" variant="ghost" className={big} onClick={zwo}>
                .zwo
              </Button>
            )}
            <Button size="lg" variant={event.status === 'done' ? 'ghost' : 'primary'} className={big} disabled={patch.isPending} onClick={toggleDone}>
              {event.status === 'done' ? 'Mark planned' : 'Mark done'}
            </Button>
          </div>
        }
      >
        {details}
        <button type="button" onClick={askCoach} className="flex min-h-11 items-center self-start border-0 bg-transparent p-0 font-semibold text-accent-ink">
          Ask coach about this session
        </button>
        {deleteControl && <div className="grid grid-cols-2 gap-2">{deleteControl}</div>}
        {errors}
      </Sheet>
    );
  }

  return (
    <aside aria-label="Selected session" className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <SectionLabel>{eyebrow}</SectionLabel>
          <h2 className="mt-1 mb-0 text-[22px]">{event.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>
      {tags}
      {details}

      <div className="grid grid-cols-2 gap-2">
        {event.workoutId && (
          <Button variant="primary" size="lg" onClick={zwo}>
            Download .zwo
          </Button>
        )}
        <Button size="lg" variant="ghost" onClick={() => setEditing(true)}>
          Edit…
        </Button>
        <Button size="lg" variant="ghost" disabled={patch.isPending} onClick={toggleDone}>
          {event.status === 'done' ? 'Mark planned' : 'Mark done'}
        </Button>
        <Button size="lg" variant="ghost" onClick={askCoach}>
          Ask coach
        </Button>
        {deleteControl}
      </div>
      {errors}
    </aside>
  );
}

const KIND_OPTIONS: { kind: SessionKind; label: string }[] = [
  { kind: 'race', label: 'Zwift race' },
  { kind: 'workout', label: 'Workout' },
  { kind: 'ride', label: 'Other ride' },
];

const ADD_LABEL: Record<SessionKind, string> = { race: 'Add race', workout: 'Add workout', ride: 'Add ride' };

/** Library workouts to pick from: search by name or category, each with its profile. */
function WorkoutPicker({ selectedId, onPick }: { selectedId: string; onPick: (w: Workout) => void }) {
  const workouts = useWorkouts();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = (workouts.data ?? []).filter((w) => !q || w.name.toLowerCase().includes(q) || w.category.toLowerCase().includes(q));
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <input
        type="search"
        placeholder="Search the library"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-10 rounded-lg border border-line-strong bg-surface px-2.5 text-sm"
        aria-label="Search workouts"
      />
      <div role="listbox" aria-label="Library workouts" className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto">
        {workouts.isPending && <div className="text-[13px] text-muted">Loading…</div>}
        {workouts.data && !list.length && <div className="text-[13px] text-muted">No workouts match.</div>}
        {list.map((w) => {
          const selected = w.id === selectedId;
          return (
            <button
              key={w.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onPick(w)}
              className="flex flex-col gap-1.5 rounded-[10px] bg-surface p-2.5 text-left"
              style={{ border: `1px solid ${selected ? '#7DA30A' : '#E3E6EB'}` }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold text-ink">{w.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{formatWorkoutDuration(workoutMetrics(w.segments).totalSec)}</span>
              </span>
              <ZoneChart segments={w.segments} height={28} />
              <span>
                <Tag>{w.category}</Tag>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** What the add and edit forms hold, as the inputs show it. */
interface SessionDraft {
  kind: SessionKind;
  date: string;
  type: SessionType;
  title: string;
  /** Add: the picked workout. Edit: a different workout picked to replace the current one. */
  workout: Workout | null;
  minutes: string;
  startTime: string;
  priority: RacePriority;
  notes: string;
}

const draftFor = (e: CalendarEvent): SessionDraft => ({
  kind: e.kind,
  date: e.date,
  type: e.type,
  title: e.title,
  workout: null,
  minutes: e.durationMin != null ? String(e.durationMin) : '',
  startTime: e.startTime ?? '',
  priority: e.priority ?? 'B',
  notes: e.coachNote ?? '',
});

/** Only what an edit changed; emptied fields are cleared (`unset`). */
function editPatch(e: CalendarEvent, d: SessionDraft): CalendarEventPatch {
  const patch: CalendarEventPatch = {};
  const unset: ClearableEventField[] = [];
  if (d.date !== e.date) patch.date = d.date;
  const start = d.startTime || undefined;
  if (start !== e.startTime) {
    if (start) patch.startTime = start;
    else unset.push('startTime');
  }
  const notes = d.notes.trim() || undefined;
  if (notes !== e.coachNote) {
    if (notes) patch.coachNote = notes;
    else unset.push('coachNote');
  }
  // A typed length (or a new workout) replaces the coach's "45–60 min" label, which would otherwise win.
  let lengthChanged = false;
  if (e.kind === 'workout') {
    if (d.workout && d.workout.id !== e.workoutId) {
      patch.workoutId = d.workout.id;
      patch.title = d.workout.name;
      patch.type = sessionTypeFor(d.workout);
      patch.durationMin = Math.round(workoutMetrics(d.workout.segments).totalSec / 60);
      lengthChanged = true;
    }
  } else {
    const title = d.title.trim();
    if (title && title !== e.title) patch.title = title;
    const minutes = d.minutes.trim() === '' ? undefined : Math.max(0, Math.round(Number(d.minutes)) || 0);
    if (minutes !== e.durationMin) {
      if (minutes !== undefined) patch.durationMin = minutes;
      else unset.push('durationMin');
      lengthChanged = true;
    }
    if (e.kind === 'race' && d.priority !== (e.priority ?? 'B')) patch.priority = d.priority;
    if (e.kind === 'ride' && d.type !== e.type) patch.type = d.type;
  }
  if (lengthChanged && e.durationLabel) unset.push('durationLabel');
  if (unset.length) patch.unset = unset;
  return patch;
}

export const FIELD = 'min-h-10 rounded-lg border border-line-strong bg-surface px-2';

/**
 * The fields of a session, shared by Add and Edit. Edit has no kind switch (changing what a session
 * is means delete + add) and shows the current workout with a Change button instead of the picker.
 */
function SessionFields({
  draft,
  set,
  current,
}: {
  draft: SessionDraft;
  set: (p: Partial<SessionDraft>) => void;
  /** Edit only: the session being edited. */
  current?: CalendarEvent | undefined;
}) {
  const [picking, setPicking] = useState(!current);
  const startField = (
    <label className="flex flex-col gap-1 text-xs text-muted">
      Start (optional)
      <input type="time" value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })} className={`${FIELD} font-mono text-ink`} />
    </label>
  );
  return (
    <>
      {!current && (
        <div role="group" aria-label="Kind" className="flex w-fit rounded-[10px] border border-line-strong bg-surface p-[3px]">
          {KIND_OPTIONS.map((k) => (
            <button
              key={k.kind}
              type="button"
              aria-pressed={draft.kind === k.kind}
              onClick={() => set({ kind: k.kind })}
              className={`min-h-[34px] rounded-lg border-0 px-3 text-[13px] ${draft.kind === k.kind ? 'bg-track font-semibold text-ink' : 'bg-transparent text-muted'}`}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      {draft.kind === 'workout' ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Date
              <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} className={`${FIELD} font-mono text-ink`} />
            </label>
            {startField}
          </div>
          {current && (
            <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-surface p-2.5 text-[13px]">
              <span className="min-w-0">
                <span className="block text-xs text-muted">Workout</span>
                <span className="block truncate font-semibold">{draft.workout?.name ?? current.title}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setPicking((p) => !p)}>
                {picking ? 'Done' : 'Change'}
              </Button>
            </div>
          )}
          {picking && (
            <WorkoutPicker
              selectedId={draft.workout?.id ?? current?.workoutId ?? ''}
              onPick={(w) => {
                set({ workout: w });
                if (current) setPicking(false);
              }}
            />
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
            Date
            <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} className={`${FIELD} font-mono text-ink`} />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
            {draft.kind === 'race' ? 'Race' : 'What it is'}
            <input
              value={draft.title}
              placeholder={draft.kind === 'race' ? 'Zwift race' : 'Z2 group ride'}
              onChange={(e) => set({ title: e.target.value })}
              className={`${FIELD} text-sm text-ink`}
            />
          </label>
          {startField}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Minutes
            <input
              type="number"
              min={0}
              value={draft.minutes}
              placeholder={current?.durationLabel ?? ''}
              onChange={(e) => set({ minutes: e.target.value })}
              className={`${FIELD} font-mono text-ink`}
            />
          </label>
          {draft.kind === 'race' ? (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Priority
              <select value={draft.priority} onChange={(e) => set({ priority: e.target.value as RacePriority })} className={`${FIELD} text-ink`}>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Intensity
              <select value={draft.type} onChange={(e) => set({ type: e.target.value as SessionType })} className={`${FIELD} text-ink`}>
                {sessionTypes
                  .filter((t) => t !== 'race')
                  .map((t) => (
                    <option key={t} value={t}>
                      {SESSION_STYLE[t].label}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted">
        Notes (optional)
        <textarea value={draft.notes} rows={2} onChange={(e) => set({ notes: e.target.value })} className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
      </label>
    </>
  );
}

const syncHint = (kind: SessionKind) =>
  kind !== 'ride' && <div className="text-xs text-muted">Races and workouts sync to intervals.icu{kind === 'workout' ? ', and workouts on to Zwift' : ''}.</div>;

/** Edit a session that hasn't been ridden: date, time, length, priority/intensity, notes, or a different workout. */
function EditPanel({ event, onDone, sheet = false }: { event: CalendarEvent; onDone: () => void; sheet?: boolean }) {
  const { patch } = useCalendarMutations();
  const [draft, setDraft] = useState(() => draftFor(event));
  const set = (p: Partial<SessionDraft>) => setDraft((d) => ({ ...d, ...p }));
  const changes = editPatch(event, draft);
  const ready = !!draft.date && (event.kind === 'workout' || !!draft.title.trim()) && Object.keys(changes).length > 0;
  const save = () => patch.mutate({ id: event.id, patch: changes }, { onSuccess: (r) => !r.syncError && onDone() });

  const eyebrow = `Edit · ${kindLabel({ ...event, startTime: undefined, priority: undefined })}`;
  const buttons = (
    <>
      <Button size="lg" variant="ghost" className="flex-1" onClick={onDone}>
        {patch.data?.syncError ? 'Close' : 'Cancel'}
      </Button>
      <Button variant="primary" size="lg" className="flex-1" disabled={!ready || patch.isPending} onClick={save}>
        {patch.isPending ? 'Saving…' : 'Save'}
      </Button>
    </>
  );
  const notes = (
    <>
      {syncHint(event.kind)}
      {patch.error && <ErrorNote>{errorMessage(patch.error)}</ErrorNote>}
      {patch.data?.syncError && <ErrorNote>Saved here, but intervals.icu didn’t update yet: {patch.data.syncError}. It’ll retry.</ErrorNote>}
    </>
  );

  if (sheet) {
    return (
      <Sheet tall eyebrow={eyebrow} title={event.title} onClose={onDone} footer={<div className="flex gap-2">{buttons}</div>}>
        <SessionFields draft={draft} set={set} current={event} />
        {notes}
      </Sheet>
    );
  }
  return (
    <aside aria-label="Edit session" className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <SectionLabel>{eyebrow}</SectionLabel>
          <h2 className="mt-1 mb-0 text-[22px]">{event.title}</h2>
        </div>
        <button type="button" onClick={onDone} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>
      <SessionFields draft={draft} set={set} current={event} />
      <div className="flex gap-2">{buttons}</div>
      {notes}
    </aside>
  );
}

/** Add a session by hand: a Zwift race, a library workout, or any other ride. */
export function AddPanel({
  date: initialDate,
  onClose,
  onAdded,
  sheet = false,
}: {
  date: string;
  onClose: () => void;
  onAdded: (id: string) => void;
  sheet?: boolean;
}) {
  const { create } = useCalendarMutations();
  const [draft, setDraft] = useState<SessionDraft>({
    kind: 'race',
    date: initialDate,
    type: 'endurance',
    title: '',
    workout: null,
    minutes: '40',
    startTime: '',
    priority: 'B',
    notes: '',
  });
  const set = (p: Partial<SessionDraft>) => setDraft((d) => ({ ...d, ...p }));
  useEffect(() => setDraft((d) => ({ ...d, date: initialDate })), [initialDate]);

  const { kind, date, workout } = draft;
  const ready = !!date && (kind === 'workout' ? !!workout : !!draft.title.trim());

  const add = () => {
    const base = {
      date,
      tentative: false,
      ...(draft.notes.trim() ? { coachNote: draft.notes.trim() } : {}),
      ...(draft.startTime ? { startTime: draft.startTime } : {}),
    };
    const input: CalendarEventInput =
      kind === 'workout' && workout
        ? {
            ...base,
            kind,
            platform: 'zwift',
            type: sessionTypeFor(workout),
            title: workout.name,
            workoutId: workout.id,
            durationMin: Math.round(workoutMetrics(workout.segments).totalSec / 60),
          }
        : {
            ...base,
            kind,
            type: kind === 'race' ? 'race' : draft.type,
            title: draft.title.trim(),
            durationMin: Number(draft.minutes) || 0,
            ...(kind === 'race' ? { platform: 'zwift' as const, priority: draft.priority } : {}),
          };
    create.mutate(input, { onSuccess: (event) => onAdded(event.id) });
  };

  const heading = date ? formatLongDay(date) : 'Pick a date';
  const form = (
    <>
      <SessionFields draft={draft} set={set} />
      <Button variant="primary" size="lg" disabled={!ready || create.isPending} onClick={add}>
        {create.isPending ? 'Adding…' : ADD_LABEL[kind]}
      </Button>
      {syncHint(kind)}
      {create.error && <ErrorNote>{errorMessage(create.error)}</ErrorNote>}
    </>
  );

  if (sheet) {
    return (
      <Sheet tall eyebrow="Add session" title={heading} onClose={onClose}>
        {form}
      </Sheet>
    );
  }
  return (
    <aside aria-label="Add session" className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <SectionLabel>Add session</SectionLabel>
          <h2 className="mt-1 mb-0 text-[22px]">{heading}</h2>
        </div>
        <button type="button" onClick={onClose} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>
      {form}
    </aside>
  );
}
