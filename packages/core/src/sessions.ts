import type { CalendarEvent, CalendarEventInput, ProposalChange, SessionType, TimeOffChange, WorkoutCategory, WorkoutSegment } from '@cycling-coach/shared';
import { flatten, workoutMetrics } from './workout';

/**
 * A session-type colour for a workout we didn't write (imported from intervals.icu), from its
 * structure: short hard bursts are openers, sustained hard work is intervals, the rest is endurance
 * or recovery by its ceiling.
 */
export function inferSessionType(segments: readonly WorkoutSegment[]): SessionType {
  const { maxPct, workSec } = workoutMetrics(segments);
  if (maxPct <= 55) return 'recovery';
  const steps = flatten(segments);
  const hardSec = steps.filter((s) => s.pct >= 88).reduce((sum, s) => sum + s.durSec, 0);
  // Openers are a few kicks. One spike is just a warm-up's opener on an easy or tempo ride.
  const kicks = steps.filter((s) => s.pct >= 106).length;
  if (maxPct >= 106 && kicks >= 2 && workSec < 6 * 60 && hardSec < 6 * 60) return 'openers';
  if (maxPct >= 88 && hardSec >= 6 * 60) return 'intervals';
  return 'endurance';
}

/** Main-set time (s) in each band, for `classifyWorkout`. */
interface BandTime {
  sprint: number;
  vo2: number;
  threshold: number;
  sweetSpot: number;
  tempo: number;
}

/** A sprint rep: this hard and this short. */
const SPRINT_PCT = 150;
const SPRINT_MAX_SEC = 30;
/** This much sprinting makes a sprint session rather than openers with a few kicks. */
const SPRINT_SESSION_SEC = 90;
/** Below this much tempo, an easy ride with a bit of tempo is still endurance. */
const TEMPO_SESSION_SEC = 20 * 60;
/** A standalone steady block only counts as main set this long — a warm-up's 1-min spike doesn't. */
const MAIN_STEADY_MIN_SEC = 180;

function bandTime(segments: readonly WorkoutSegment[]): BandTime {
  const t: BandTime = { sprint: 0, vo2: 0, threshold: 0, sweetSpot: 0, tempo: 0 };
  const add = (pct: number, durSec: number, reps: number) => {
    const sec = durSec * reps;
    if (pct >= SPRINT_PCT && durSec <= SPRINT_MAX_SEC) t.sprint += sec;
    else if (pct >= 106) t.vo2 += sec;
    else if (pct >= 95) t.threshold += sec;
    else if (pct >= 88) t.sweetSpot += sec;
    else if (pct >= 76) t.tempo += sec;
  };
  for (const s of segments) {
    if (s.kind === 'repeat') for (const step of s.steps) add(step.pct, step.durSec, s.count);
    else if (s.kind === 'steady' && s.durSec >= MAIN_STEADY_MIN_SEC) add(s.pct, s.durSec, 1);
  }
  return t;
}

/**
 * A library category for a workout we didn't write (imported from intervals.icu), from its main set:
 * repeat steps and steady blocks of 3 min or more. Warm-up spikes and ramps don't count, so a sweet
 * spot session with a 1-min opener in its warm-up is sweet spot, not VO2. The band with the most time
 * wins; a tie goes to the harder one. It can't tell race prep or a test from their structure.
 */
export function classifyWorkout(segments: readonly WorkoutSegment[]): WorkoutCategory {
  const type = inferSessionType(segments);
  if (type === 'recovery') return 'Recovery';
  const t = bandTime(segments);
  if (t.sprint >= SPRINT_SESSION_SEC && t.sprint >= t.vo2 + t.threshold + t.sweetSpot) return 'Sprint';
  if (type === 'openers') return 'Openers';
  if (type === 'endurance') return t.tempo >= TEMPO_SESSION_SEC ? 'Tempo' : 'Endurance';
  const ranked: [WorkoutCategory, number][] = [
    ['VO2 max', t.vo2 + t.sprint],
    ['Threshold', t.threshold],
    ['Sweet spot', t.sweetSpot],
    ['Tempo', t.tempo],
  ];
  const [best] = ranked.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best;
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

export const isTimeOffChange = (change: ProposalChange): change is TimeOffChange => change.op.startsWith('time_off_');

/**
 * Before and after for one proposed calendar change, from the snapshot taken when it was proposed.
 * Proposals from before snapshots existed have no `before` (undefined): adds still preview, the rest
 * fall back to what the change itself says.
 */
export function previewCalendarChange(change: ProposalChange, before: CalendarEvent | null | undefined): ChangePreview {
  // Time off isn't a session: its row carries its own "was", and the `before` slot is always null.
  if (isTimeOffChange(change)) return { before: null, after: null, changed: [], missing: false };
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
