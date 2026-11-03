import type { CalendarChange, CalendarEvent, CalendarEventInput, SessionType, WorkoutSegment } from '@cycling-coach/shared';
import { flatten, workoutMetrics } from './workout';

/**
 * A session-type colour for a workout we didn't write (imported from intervals.icu), from its
 * structure: short hard bursts are openers, sustained hard work is intervals, the rest is endurance
 * or recovery by its ceiling.
 */
export function inferSessionType(segments: readonly WorkoutSegment[]): SessionType {
  const { maxPct, workSec } = workoutMetrics(segments);
  if (maxPct <= 55) return 'recovery';
  const hardSec = flatten(segments)
    .filter((s) => s.pct >= 88)
    .reduce((sum, s) => sum + s.durSec, 0);
  if (maxPct >= 106 && workSec < 6 * 60 && hardSec < 6 * 60) return 'openers';
  if (maxPct >= 88 && hardSec >= 6 * 60) return 'intervals';
  return 'endurance';
}

/** Only sessions that weren't ridden can be deleted — a completed one keeps its plan↔ride pairing. */
export function canDeleteSession(e: Pick<CalendarEvent, 'status' | 'activityId' | 'extraActivityIds'>): boolean {
  return e.status !== 'done' && !e.activityId && !e.extraActivityIds?.length;
}

/** How a session reads on the calendar: `done` is shown as completed. */
export type SessionState = 'planned' | 'completed' | 'missed' | 'skipped';

export function sessionState(e: Pick<CalendarEvent, 'status'>): SessionState {
  return e.status === 'done' ? 'completed' : e.status;
}

/** A session as a change card shows it: an existing event or one about to be created. */
export type SessionPreview = CalendarEventInput | CalendarEvent;

/** Fields a change card spells out as old → new. */
export const PREVIEW_FIELDS = ['date', 'title', 'type', 'kind', 'duration', 'startTime', 'priority', 'workoutId', 'tentative', 'meta', 'coachNote'] as const;
export type PreviewField = (typeof PREVIEW_FIELDS)[number];

export interface ChangePreview {
  /** The event as it was when the change was proposed; null for an add. */
  before: SessionPreview | null;
  /** The event as it will be once applied; null for a remove. */
  after: SessionPreview | null;
  /** Fields that differ between before and after (move and update only). */
  changed: PreviewField[];
  /** The change names an event that didn't exist when it was proposed, so applying it will fail. */
  missing: boolean;
}

const previewValue = (e: SessionPreview, f: PreviewField) =>
  f === 'duration' ? `${e.durationMin ?? ''}|${e.durationLabel ?? ''}` : e[f];

/**
 * Before and after for one proposed calendar change, from the snapshot taken when it was proposed.
 * Proposals from before snapshots existed have no `before` (undefined): adds still preview, the rest
 * fall back to what the change itself says.
 */
export function previewCalendarChange(change: CalendarChange, before: CalendarEvent | null | undefined): ChangePreview {
  if (change.op === 'add') return { before: null, after: change.event, changed: [], missing: false };
  const missing = before === null;
  if (!before) return { before: null, after: null, changed: [], missing };
  if (change.op === 'remove') return { before, after: null, changed: [], missing };
  // A patch key set to undefined leaves the field as it was, as it does when applied.
  const patch = change.op === 'move' ? { date: change.toDate } : Object.fromEntries(Object.entries(change.patch).filter(([, v]) => v !== undefined));
  const after = { ...before, ...patch } as CalendarEvent;
  const changed = PREVIEW_FIELDS.filter((f) => previewValue(before, f) !== previewValue(after, f));
  return { before, after, changed, missing };
}
