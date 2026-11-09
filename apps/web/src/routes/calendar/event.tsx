import { canDeleteSession, courseMinutes, formatLongDay, goalForEvent, parseDurationText } from '@cycling-coach/core';
import {
  EVENT_TYPE_LABEL,
  EVENT_TYPE_SHORT,
  eventTypes,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventPatch,
  type ClearableEventField,
  type EventInfo,
  type EventType,
  type Goal,
  type SessionFeedback,
} from '@cycling-coach/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { AskToAdjust, MissedNoteCard } from '../../components/MissedNoteCard';
import { CheckCircleIcon, FlagIcon, LogoIcon, MoreIcon, TrashIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { Button, ErrorNote, SectionLabel, StatTile } from '../../components/ui';
import type { ReadCourse } from '../../lib/course';
import { estimateText, eventHref, eventLinkText, eventWhen } from '../../lib/eventInfo';
import { errorMessage, useCalendarMutations, useCourse, useCourseMutations, useDashboard, useProfile, useProfileMutations } from '../../lib/queries';
import { SESSION_STYLE } from '../../lib/session';
import { CoachingFields, coachingFor, coachingSummary, eventGoalInput, eventGoalPatch, NO_COACHING, type CoachingDraft } from './coaching';
import { CourseCard, CoursePicker } from './course';
import { askEventPrompt, FIELD, PANEL } from './shared';
import { SyncRow } from './sync';

/**
 * Real-world events on the calendar (DECISIONS #98): a fondo, crit or race the athlete has entered.
 * Each is a `race` session ridden outdoors with `eventInfo`. Mockups: design/events-2026-11-07.
 */

type Priority = 'A' | 'B' | 'C';
const PRIORITY_MEANING: Record<Priority, string> = {
  A: 'The one that matters most. Your coach tapers you for it.',
  B: 'Arrive rested, without a full taper.',
  C: 'Train through it.',
};
const RACE = SESSION_STYLE.race;
const optional = <span className="text-faint">· optional</span>;

/** What the add and edit forms hold, as the inputs show it. */
interface EventDraft {
  type: EventType | '';
  title: string;
  date: string;
  startTime: string;
  distance: string;
  ascent: string;
  est: string;
  location: string;
  url: string;
  priority: Priority | null;
  notes: string;
}

const emptyDraft = (date: string): EventDraft => ({
  type: '',
  title: '',
  date,
  startTime: '',
  distance: '',
  ascent: '',
  est: '',
  location: '',
  url: '',
  priority: null,
  notes: '',
});

const draftFor = (e: CalendarEvent): EventDraft => ({
  type: e.eventInfo?.type ?? '',
  title: e.title,
  date: e.date,
  startTime: e.startTime ?? '',
  distance: e.eventInfo?.distanceKm !== undefined ? String(e.eventInfo.distanceKm) : '',
  ascent: e.eventInfo?.ascentM !== undefined ? String(e.eventInfo.ascentM) : '',
  est: estimateText(e.durationMin),
  location: e.eventInfo?.location ?? '',
  url: e.eventInfo?.url ?? '',
  priority: e.priority ?? 'B',
  notes: e.coachNote ?? '',
});

/** "142", "142.5", "142,5". */
const readKm = (s: string) => (/^\d+([.,]\d+)?$/.test(s.trim()) ? Number(s.trim().replace(',', '.')) : null);
/** "2350", "2,350", "2 350". */
const readMeters = (s: string) => (/^\d[\d, ]*$/.test(s.trim()) ? Number(s.replace(/\D/g, '')) : null);

/** What the inputs mean, or why they don't make sense yet. */
function readDraft(d: EventDraft): { info: EventInfo | null; minutes: number | undefined; problems: string[] } {
  const problems: string[] = [];
  const km = d.distance.trim() ? readKm(d.distance) : undefined;
  if (km === null || (km !== undefined && km > 2000)) problems.push('Distance is in km, like 142.');
  const m = d.ascent.trim() ? readMeters(d.ascent) : undefined;
  if (m === null || (m !== undefined && m > 30000)) problems.push('Elevation is in metres, like 2350.');
  const minutes = d.est.trim() ? parseDurationText(d.est) : undefined;
  if (minutes === null || (minutes !== undefined && minutes > 24 * 60)) problems.push('Est. time reads like “5 h 30” or “330 min”.');
  const location = d.location.trim();
  const url = d.url.trim();
  const info: EventInfo | null = d.type
    ? {
        type: d.type,
        ...(typeof km === 'number' ? { distanceKm: km } : {}),
        ...(typeof m === 'number' && m > 0 ? { ascentM: m } : {}),
        ...(location ? { location } : {}),
        ...(url ? { url } : {}),
      }
    : null;
  return { info, minutes: minutes ?? undefined, problems };
}

const sameInfo = (a: EventInfo | undefined, b: EventInfo | null) =>
  !!a === !!b && (!a || !b || (a.type === b.type && a.distanceKm === b.distanceKm && a.ascentM === b.ascentM && a.location === b.location && a.url === b.url));

function addInput(d: EventDraft, info: EventInfo, minutes: number | undefined): CalendarEventInput {
  const notes = d.notes.trim();
  return {
    date: d.date,
    kind: 'race',
    type: 'race',
    platform: 'garmin',
    title: d.title.trim(),
    tentative: false,
    eventInfo: info,
    ...(d.startTime ? { startTime: d.startTime } : {}),
    ...(d.priority ? { priority: d.priority } : {}),
    ...(minutes ? { durationMin: minutes } : {}),
    ...(notes ? { coachNote: notes } : {}),
  };
}

/** Only what an edit changed; emptied fields are cleared (`unset`). */
function editPatch(e: CalendarEvent, d: EventDraft, info: EventInfo | null, minutes: number | undefined): CalendarEventPatch {
  const patch: CalendarEventPatch = {};
  const unset: ClearableEventField[] = [];
  const title = d.title.trim();
  if (title && title !== e.title) patch.title = title;
  if (d.date !== e.date) patch.date = d.date;
  const start = d.startTime || undefined;
  if (start !== e.startTime) {
    if (start) patch.startTime = start;
    else unset.push('startTime');
  }
  if (d.priority && d.priority !== (e.priority ?? 'B')) patch.priority = d.priority;
  if (minutes !== e.durationMin) {
    if (minutes) patch.durationMin = minutes;
    else unset.push('durationMin');
    if (e.durationLabel) unset.push('durationLabel');
  }
  const notes = d.notes.trim() || undefined;
  if (notes !== e.coachNote) {
    if (notes) patch.coachNote = notes;
    else unset.push('coachNote');
  }
  if (info && !sameInfo(e.eventInfo, info)) patch.eventInfo = info;
  if (e.platform !== 'garmin') patch.platform = 'garmin';
  if (unset.length) patch.unset = unset;
  return patch;
}

/** Fields a GPX fills in; each keeps a "from GPX" mark until the athlete edits it. */
type GpxField = 'title' | 'distance' | 'ascent' | 'est';

function GpxMark({ children = 'from GPX' }: { children?: ReactNode }) {
  return <span className="ml-1.5 self-start rounded-full border border-accent-line bg-accent-tint px-1.5 text-[11px] leading-4 font-semibold text-accent-ink">{children}</span>;
}

function Label({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs text-muted">
      {children}
    </label>
  );
}

/**
 * Add an event, or edit one (`event`). Adding ends on a short confirmation with the next steps,
 * the first of which is asking the coach how to get ready.
 */
export function EventFormPanel({
  date = '',
  event,
  onClose,
  onView,
  sheet = false,
}: {
  /** A new event's date. */
  date?: string | undefined;
  /** The event being edited. */
  event?: CalendarEvent | undefined;
  onClose: () => void;
  /** After adding: open the new event, which may be far off the dates on screen. */
  onView?: ((event: CalendarEvent) => void) | undefined;
  sheet?: boolean;
}) {
  const navigate = useNavigate();
  const today = useDashboard().data?.today ?? date;
  const profile = useProfile().data;
  const athlete = profile?.profile;
  const otherMain = profile?.goals.find((g) => g.primary)?.title;
  const { create, patch } = useCalendarMutations();
  const { createGoal } = useProfileMutations();
  const [coaching, setCoaching] = useState<CoachingDraft>(NO_COACHING);
  const [addedGoal, setAddedGoal] = useState<Goal | null>(null);
  const [goalFailed, setGoalFailed] = useState<string | null>(null);
  const { put: putCourse, remove: removeCourse } = useCourseMutations();
  const existing = useCourse(event?.id ?? '', !!event?.courseId);
  const [draft, setDraft] = useState<EventDraft>(() => (event ? draftFor(event) : emptyDraft(date)));
  const [added, setAdded] = useState<CalendarEvent | null>(null);
  /** A course read from a GPX here, not yet saved. */
  const [picked, setPicked] = useState<ReadCourse | null>(null);
  const [courseRemoved, setCourseRemoved] = useState(false);
  const [courseFailed, setCourseFailed] = useState<string | null>(null);
  const [fromGpx, setFromGpx] = useState<ReadonlySet<GpxField>>(new Set());
  const set = (p: Partial<EventDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    // A field the athlete has edited is theirs now, not the GPX's.
    setFromGpx((m) => (Object.keys(p).some((k) => m.has(k as GpxField)) ? new Set([...m].filter((k) => !(k in p))) : m));
  };

  const course = picked
    ? { fileName: picked.input.fileName, analysis: picked.analysis }
    : !courseRemoved && existing.data
      ? { fileName: existing.data.fileName, analysis: existing.data.analysis }
      : null;
  /** Fill in what the GPX knows: fields still empty, or still holding an earlier file's values. */
  const readCourse = (r: ReadCourse) => {
    setPicked(r);
    setCourseRemoved(false);
    const a = r.analysis;
    const open = (k: GpxField) => !draft[k].trim() || fromGpx.has(k);
    const fill: Partial<EventDraft> = {};
    if (r.input.name && open('title')) fill.title = r.input.name;
    if (open('distance')) fill.distance = String(a.distanceKm);
    if (a.ascentM !== null && open('ascent')) fill.ascent = String(a.ascentM);
    else if (a.ascentM === null && fromGpx.has('ascent')) fill.ascent = '';
    if (athlete?.ftpZwift && open('est')) fill.est = estimateText(courseMinutes(a, athlete.ftpZwift, athlete.weightKg));
    setDraft((d) => ({ ...d, ...fill }));
    setFromGpx((m) => new Set([...[...m].filter((k) => !(k in fill)), ...(Object.keys(fill) as GpxField[]).filter((k) => fill[k])]));
  };
  const dropCourse = () => {
    setPicked(null);
    if (event?.courseId) setCourseRemoved(true);
    setFromGpx(new Set());
  };

  const { info, minutes, problems } = readDraft(draft);
  const complete = !!info && !!draft.title.trim() && !!draft.date;
  const changes = event && complete && !problems.length ? editPatch(event, draft, info, minutes) : {};
  const courseChanged = !!picked || courseRemoved;
  const ready = complete && !problems.length && (!event || Object.keys(changes).length > 0 || courseChanged);
  const busy = create.isPending || patch.isPending || putCourse.isPending || removeCourse.isPending || createGoal.isPending;
  const save = async () => {
    if (!ready || !info) return;
    setCourseFailed(null);
    if (event) {
      try {
        const changed = Object.keys(changes).length ? await patch.mutateAsync({ id: event.id, patch: changes }) : null;
        if (picked) await putCourse.mutateAsync({ id: event.id, input: picked.input });
        else if (courseRemoved) await removeCourse.mutateAsync(event.id);
        if (!changed?.syncError) onClose();
      } catch {
        // Shown from the mutation's error.
      }
      return;
    }
    let made: CalendarEvent;
    try {
      made = await create.mutateAsync(addInput(draft, info, minutes));
    } catch {
      return;
    }
    if (picked) await putCourse.mutateAsync({ id: made.id, input: picked.input }).catch((e: unknown) => setCourseFailed(errorMessage(e)));
    // Yes to the first coaching question: a goal for the event, with the weight and aim (DECISIONS #100).
    if (coaching.q1 === 'yes') {
      await createGoal
        .mutateAsync(eventGoalInput(made, coaching))
        .then(setAddedGoal)
        .catch((e: unknown) => setGoalFailed(errorMessage(e)));
    }
    setAdded(made);
  };
  const askCoach = (e: CalendarEvent) => void navigate({ to: '/', search: { new: true, prompt: askEventPrompt(e.title, e.date, e.id) } });
  const id = event ? `ee-${event.id}` : 'ea';
  const heading = event ? 'Edit event' : 'Add event';

  const form = (
    <>
      <CoursePicker current={course} onRead={readCourse} onRemove={dropCourse} editing={!!event} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-type`}>Type</Label>
        <select id={`${id}-type`} value={draft.type} onChange={(e) => set({ type: e.target.value as EventType | '' })} className={`${FIELD} ${draft.type ? 'text-ink' : 'text-faint'}`}>
          <option value="">Choose a type</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {EVENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-name`}>Name{fromGpx.has('title') && <GpxMark />}</Label>
        <input id={`${id}-name`} value={draft.title} maxLength={120} placeholder="e.g. Coast Range Gran Fondo" onChange={(e) => set({ title: e.target.value })} className={`${FIELD} text-sm text-ink`} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-date`}>Date</Label>
          <input id={`${id}-date`} type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} className={`${FIELD} font-mono text-ink`} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-start`}>Start {optional}</Label>
          <input id={`${id}-start`} type="time" value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })} className={`${FIELD} font-mono text-ink`} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-dist`}>Distance (km)</Label>
          <input id={`${id}-dist`} inputMode="decimal" value={draft.distance} onChange={(e) => set({ distance: e.target.value })} className={`${FIELD} min-w-0 font-mono text-ink`} />
          {fromGpx.has('distance') && <GpxMark />}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-elev`}>Elevation (m)</Label>
          <input id={`${id}-elev`} inputMode="numeric" value={draft.ascent} onChange={(e) => set({ ascent: e.target.value })} className={`${FIELD} min-w-0 font-mono text-ink`} />
          {fromGpx.has('ascent') && <GpxMark />}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-est`}>Est. time</Label>
          <input id={`${id}-est`} value={draft.est} placeholder="~h mm" onChange={(e) => set({ est: e.target.value })} className={`${FIELD} min-w-0 font-mono text-ink`} />
          {fromGpx.has('est') && <GpxMark>from GPX + FTP</GpxMark>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-loc`}>Location {optional}</Label>
          <input id={`${id}-loc`} value={draft.location} maxLength={120} placeholder="Town, province" onChange={(e) => set({ location: e.target.value })} className={`${FIELD} min-w-0 text-sm text-ink`} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-link`}>Link {optional}</Label>
          <input id={`${id}-link`} type="url" value={draft.url} maxLength={300} placeholder="Event website" onChange={(e) => set({ url: e.target.value })} className={`${FIELD} min-w-0 text-sm text-ink`} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={`${id}-prio`} className="text-xs text-muted">
          Race priority
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-prio`} className="grid w-[180px] grid-cols-3 rounded-[10px] bg-hover p-[3px]">
          {(['A', 'B', 'C'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={draft.priority === p}
              onClick={() => set({ priority: p })}
              className={`min-h-8 rounded-lg border-0 font-mono text-[13px] ${draft.priority === p ? 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(21,24,30,.12)]' : 'bg-transparent text-muted'}`}
            >
              {p}
            </button>
          ))}
        </div>
        {draft.priority && (
          <div className="text-[13px] text-ink">
            <strong>{draft.priority}:</strong> {PRIORITY_MEANING[draft.priority]}
          </div>
        )}
        <div className="text-xs text-muted">Priority syncs to intervals.icu.</div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-notes`}>Notes {optional}</Label>
        <textarea
          id={`${id}-notes`}
          rows={2}
          value={draft.notes}
          maxLength={1000}
          placeholder="Anything worth knowing, like the start wave or a support stop"
          onChange={(e) => set({ notes: e.target.value })}
          className="min-h-16 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </div>
      {!event && (
        <section aria-labelledby={`${id}-coach`} className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <LogoIcon size={16} className="text-accent-ink" />
            <h3 id={`${id}-coach`} className="m-0 text-[15px]">
              Coaching
            </h3>
          </div>
          <CoachingFields id={id} draft={coaching} set={(d) => setCoaching((c) => ({ ...c, ...d }))} otherMain={otherMain} />
          {coaching.q1 === 'yes' && (
            <div className="text-xs text-muted">
              This adds a goal for the event. Change it any time on <strong className="text-ink">Athlete › Goals &amp; coach</strong>.
            </div>
          )}
        </section>
      )}
      {problems.length > 0 && (
        <div role="alert" className="text-[13px] text-[#B54708]">
          {problems.join(' ')}
        </div>
      )}
      {event ? (
        <div className="flex gap-2">
          <Button size="lg" variant="ghost" className="flex-1" onClick={onClose}>
            {patch.data?.syncError ? 'Close' : 'Cancel'}
          </Button>
          <Button size="lg" variant="primary" className="flex-1" disabled={!ready || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button size="lg" variant="primary" disabled={!ready || busy} onClick={() => void save()}>
            {busy ? 'Adding…' : 'Add event'}
          </Button>
          {!complete && <span className="text-xs text-muted">Add a type, name and date to continue.</span>}
        </div>
      )}
      {(create.error || patch.error) && <ErrorNote>{errorMessage(create.error ?? patch.error)}</ErrorNote>}
      {event && (putCourse.error || removeCourse.error) && <ErrorNote>Couldn’t save the course: {errorMessage(putCourse.error ?? removeCourse.error)}</ErrorNote>}
      {event && <div className="text-xs text-muted">Coaching for this event is changed on the event panel or on Athlete › Goals &amp; coach.</div>}
      {patch.data?.syncError && <ErrorNote>Saved here, but intervals.icu didn’t update yet: {patch.data.syncError}. It’ll retry.</ErrorNote>}
    </>
  );

  const done = added && (
    <>
      <div role="status" className="flex flex-col gap-1 rounded-[10px] border border-accent-line bg-accent-tint-2 p-3">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircleIcon size={18} className="text-accent-ink" /> {added.title} added.
        </div>
        <div className="text-[13px] text-muted">
          {formatLongDay(added.date)}, {added.date.slice(0, 4)} · {added.eventInfo ? EVENT_TYPE_SHORT[added.eventInfo.type] : 'Event'} · priority {added.priority ?? 'B'}
        </div>
      </div>
      {addedGoal ? (
        <div className="text-[13px]">Goal added: {coachingSummary(addedGoal)}</div>
      ) : (
        !goalFailed && <div className="text-[13px] text-muted">No goal added. Your coach plans around the day itself.</div>
      )}
      {courseFailed && <ErrorNote>The event is added, but its course didn’t save: {courseFailed}. Add it again from the event.</ErrorNote>}
      {goalFailed && <ErrorNote>The event is added, but its goal didn’t save: {goalFailed}. Use Take it into account on the event.</ErrorNote>}
      <Button size="lg" variant="primary" onClick={() => askCoach(added)}>
        Ask your coach how to get ready →
      </Button>
      {onView && (
        <Button size="lg" variant="ghost" onClick={() => onView(added)}>
          View event
        </Button>
      )}
      <button
        type="button"
        onClick={() => {
          setAdded(null);
          create.reset();
          putCourse.reset();
          createGoal.reset();
          setCoaching(NO_COACHING);
          setAddedGoal(null);
          setGoalFailed(null);
          setPicked(null);
          setCourseFailed(null);
          setFromGpx(new Set());
          setDraft(emptyDraft(date || today));
        }}
        className="self-start border-0 bg-transparent p-0 text-[13px] font-medium text-muted underline-offset-2 hover:underline"
      >
        Add another event
      </button>
    </>
  );

  if (sheet) {
    return (
      <Sheet tall title={heading} onClose={onClose}>
        <div className="flex flex-col gap-4">{done || form}</div>
      </Sheet>
    );
  }
  return (
    <aside aria-label={heading} className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="m-0 text-[22px]">{heading}</h2>
        <button type="button" onClick={onClose} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>
      {done || form}
    </aside>
  );
}

const CHIP = 'rounded-full border border-accent-line bg-accent-tint px-2.5 py-0.5 text-xs font-semibold text-[#2F4A0D]';

/**
 * Whether the coach is training the athlete for this event, and how much (DECISIONS #100): the event's
 * goal, or a way to make one. Edits here are the same questions as Add event.
 */
function CoachingCard({ event, goal, otherMain }: { event: CalendarEvent; goal: Goal | undefined; otherMain: string | undefined }) {
  const { createGoal, updateGoal, deleteGoal } = useProfileMutations();
  const [draft, setDraft] = useState<CoachingDraft | null>(null);
  const busy = createGoal.isPending || updateGoal.isPending || deleteGoal.isPending;
  const error = createGoal.error ?? updateGoal.error ?? deleteGoal.error;
  const save = async () => {
    if (!draft) return;
    try {
      if (draft.q1 === 'yes' && goal) await updateGoal.mutateAsync({ id: goal.id, patch: eventGoalPatch(goal, draft) });
      else if (draft.q1 === 'yes') await createGoal.mutateAsync(eventGoalInput(event, draft));
      else if (draft.q1 === 'no' && goal) await deleteGoal.mutateAsync(goal.id);
      setDraft(null);
    } catch {
      // Shown below.
    }
  };

  if (draft) {
    return (
      <section aria-label="Edit coaching" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5">
        <CoachingFields id={`ec-${event.id}`} draft={draft} set={(d) => setDraft((c) => c && { ...c, ...d })} otherMain={otherMain} hadGoal={!!goal} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !draft.q1} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      </section>
    );
  }
  if (goal) {
    return (
      <section aria-labelledby={`coach-${event.id}`} className="flex flex-col gap-2 rounded-xl border border-accent-line bg-accent-tint-2 p-3.5">
        <div className="flex items-center gap-2">
          <LogoIcon size={16} className="shrink-0 text-accent-ink" />
          <h3 id={`coach-${event.id}`} className="m-0 flex-auto text-[15px]">
            Your coach is training you for this
          </h3>
          <Button size="sm" variant="ghost" onClick={() => setDraft(coachingFor(goal))}>
            Edit
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {coachingSummary(goal)
            .split(' · ')
            .map((c) => (
              <span key={c} className={CHIP}>
                {c}
              </span>
            ))}
        </div>
        {goal.detail && <div className="text-[13px] text-[#3A414D]">“{goal.detail}”</div>}
        <Link to="/athlete/$tab" params={{ tab: 'goals' }} className="self-start text-[13px] font-semibold">
          Goal on Athlete › Goals &amp; coach
        </Link>
      </section>
    );
  }
  return (
    <section aria-label="Coaching" className="flex flex-col items-start gap-2 rounded-xl border border-line bg-surface p-3.5">
      <div className="text-[13px]">Your coach isn’t training you for this. It plans around the day itself.</div>
      <Button size="sm" onClick={() => setDraft({ ...NO_COACHING, q1: 'yes' })}>
        Take it into account
      </Button>
    </section>
  );
}

/** An event's tags: what it is, its priority and that it's ridden outdoors. */
function EventTags({ event }: { event: CalendarEvent }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold" style={{ color: RACE.fg, background: RACE.bg }}>
        <FlagIcon size={12} aria-hidden="true" />
        {event.eventInfo ? EVENT_TYPE_SHORT[event.eventInfo.type] : 'Event'}
      </span>
      {event.priority && (
        <span title="Race priority" className="rounded-md bg-ink px-2 py-0.5 font-mono text-xs font-semibold text-white">
          {event.priority}
        </span>
      )}
      {event.platform === 'garmin' && <span className="rounded-md bg-hover px-2 py-0.5 text-xs font-semibold text-[#4B5563]">Outdoor</span>}
    </div>
  );
}

/**
 * A planned event's panel: what and where, then asking the coach how to get ready. Once it's
 * ridden, the completed-session panel takes over.
 */
export function EventPanel({ event, feedback, onClose, sheet = false }: { event: CalendarEvent; feedback: SessionFeedback | undefined; onClose: () => void; sheet?: boolean | undefined }) {
  const navigate = useNavigate();
  const today = useDashboard().data?.today ?? event.date;
  const { patch, remove } = useCalendarMutations();
  const goals = useProfile().data?.goals;
  const goal = goals ? goalForEvent(goals, event.id) : undefined;
  const otherMain = goals?.find((g) => g.primary && g.id !== goal?.id)?.title;
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
  const [more, setMore] = useState(false);
  const [removeGoal, setRemoveGoal] = useState(true);

  if (mode === 'edit') return <EventFormPanel event={event} sheet={sheet} onClose={() => setMode('view')} />;

  const info = event.eventInfo;
  const when = eventWhen(event, today);
  const askCoach = () => void navigate({ to: '/', search: { new: true, prompt: askEventPrompt(event.title, event.date, event.id) } });
  const canMarkDone = event.date <= today && event.status !== 'done';
  const deletable = canDeleteSession(event);

  const body = (
    <>
      <SyncRow event={event} />
      {info && (
        <div className="grid grid-cols-3 gap-2">
          <StatTile compact label="Distance" value={info.distanceKm !== undefined ? Math.round(info.distanceKm * 10) / 10 : undefined} unit="km" />
          <StatTile compact label="Elevation" value={info.ascentM ? info.ascentM.toLocaleString('en-US') : undefined} unit="m" />
          <StatTile compact label="Est. time" value={estimateText(event.durationMin) || undefined} />
        </div>
      )}
      {(info?.location || info?.url) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          {info.location && <span>{info.location}</span>}
          {info.location && info.url && <span aria-hidden="true">·</span>}
          {info.url && (
            <a href={eventHref(info.url)} target="_blank" rel="noreferrer">
              {eventLinkText(info.url)} ↗
            </a>
          )}
        </div>
      )}
      {!info && (
        <div className="flex flex-col items-start gap-2 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
          <div>
            {event.source === 'intervals' && <strong>Imported from intervals.icu with just a name, date and priority. </strong>}
            Add the type, distance and course so your coach knows what the day asks for.
          </div>
          <Button size="sm" onClick={() => setMode('edit')}>
            Add event details
          </Button>
        </div>
      )}
      <CourseCard event={event} />
      {goals && <CoachingCard event={event} goal={goal} otherMain={otherMain} />}
      {(event.status === 'missed' || event.status === 'skipped') && (
        <>
          <MissedNoteCard key={event.id} eventId={event.id} feedback={feedback} />
          <AskToAdjust event={event} />
        </>
      )}
      {event.coachNote && (
        <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface p-3 text-[13px] whitespace-pre-wrap">
          <span className="text-xs font-semibold text-muted">Notes</span>
          {event.coachNote}
        </div>
      )}
    </>
  );

  const confirm = mode === 'delete' && (
    <div role="alertdialog" aria-labelledby={`del-${event.id}`} className="flex flex-col gap-2 rounded-[10px] border border-[#F1B5B0] bg-surface p-3">
      <span id={`del-${event.id}`} className="font-semibold">
        Delete {event.title}?
      </span>
      <span className="text-[13px] text-muted">{event.intervals ? 'It comes off your calendar and off intervals.icu.' : 'It comes off your calendar.'}</span>
      {goal && (
        <label className="flex min-h-10 items-center gap-2 text-[13px]">
          <input type="checkbox" checked={removeGoal} onChange={(e) => setRemoveGoal(e.target.checked)} className="h-[18px] w-[18px] accent-accent-ink" />
          Also remove its goal
        </label>
      )}
      <div className="flex gap-2">
        <Button size="lg" variant="ghost" className="flex-1" onClick={() => setMode('view')}>
          Cancel
        </Button>
        <Button size="lg" variant="danger" className="flex-1" disabled={remove.isPending} onClick={() => remove.mutate({ id: event.id, removeGoal: !!goal && removeGoal }, { onSuccess: onClose })}>
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </div>
  );
  const markDone = canMarkDone && (
    <Button size="lg" variant="ghost" disabled={patch.isPending} onClick={() => patch.mutate({ id: event.id, patch: { status: 'done' } })}>
      Mark done
    </Button>
  );
  const errors = (patch.error || remove.error) && <ErrorNote>{errorMessage(patch.error ?? remove.error)}</ErrorNote>;

  if (sheet) {
    return (
      <Sheet
        tall
        eyebrow={when}
        title={event.title}
        header={
          <div className="mt-1.5">
            <EventTags event={event} />
          </div>
        }
        onClose={onClose}
        footer={
          <div className="flex gap-2">
            <Button size="lg" variant="primary" className="min-h-[48px]! flex-1 rounded-xl" onClick={askCoach}>
              Ask coach about this event
            </Button>
            <Button size="lg" variant="ghost" className="min-h-[48px]! rounded-xl" aria-label="More: Edit, Delete" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <MoreIcon />
            </Button>
          </div>
        }
      >
        {body}
        {more && mode !== 'delete' && (
          <div className="flex gap-2">
            <Button size="lg" variant="ghost" className="flex-1" onClick={() => setMode('edit')}>
              Edit
            </Button>
            {deletable && (
              <Button size="lg" variant="danger" className="flex-1" onClick={() => setMode('delete')}>
                Delete…
              </Button>
            )}
          </div>
        )}
        {markDone}
        {confirm}
        {errors}
      </Sheet>
    );
  }

  return (
    <aside aria-label="Selected event" className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <SectionLabel>{when}</SectionLabel>
          <h2 className="m-0 text-[22px]">{event.title}</h2>
          <EventTags event={event} />
        </div>
        <button type="button" onClick={onClose} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>
      {body}
      {confirm || (
        <div className="flex gap-2">
          <Button size="lg" variant="primary" className="flex-1" onClick={askCoach}>
            Ask coach about this event
          </Button>
          <Button size="lg" variant="ghost" onClick={() => setMode('edit')}>
            Edit
          </Button>
          {deletable && (
            <Button size="lg" variant="ghost" aria-label="Delete event" onClick={() => setMode('delete')}>
              <TrashIcon />
            </Button>
          )}
        </div>
      )}
      {markDone}
      {errors}
    </aside>
  );
}
