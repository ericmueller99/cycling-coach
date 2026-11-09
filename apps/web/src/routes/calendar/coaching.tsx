import { eventGoalWeight } from '@cycling-coach/core';
import {
  EVENT_AIM_LABEL,
  EVENT_WEIGHT_BLURB,
  EVENT_WEIGHT_LABEL,
  eventAims,
  type CalendarEvent,
  type EventAim,
  type EventWeightChoice,
  type Goal,
  type GoalInput,
  type GoalPatch,
} from '@cycling-coach/shared';

/**
 * The coaching questions (DECISIONS #100): "Should your coach take this event into account…?" and "How
 * much weight…?", then an optional aim. Answering yes makes a goal for the event; the weight lives on it.
 * Used by Add event, the event panel and the goal editor on the Athlete page.
 */

export interface CoachingDraft {
  q1: 'yes' | 'no' | null;
  weight: EventWeightChoice | null;
  aim: EventAim | null;
  note: string;
}

export const NO_COACHING: CoachingDraft = { q1: null, weight: null, aim: null, note: '' };

/** The answers a goal already gives: yes, its weight, aim and note. */
export const coachingFor = (goal: Goal | undefined): CoachingDraft =>
  goal ? { q1: 'yes', weight: eventGoalWeight(goal), aim: goal.aim ?? null, note: goal.detail ?? '' } : NO_COACHING;

/** A weight not picked yet counts as Keep in mind, the lightest. */
const stored = (d: CoachingDraft) => (d.weight === 'main' ? 'important' : (d.weight ?? 'in_mind'));

/** A new goal for this event. The server dates it by the event. */
export function eventGoalInput(event: Pick<CalendarEvent, 'id' | 'title' | 'date'>, d: CoachingDraft): GoalInput {
  const note = d.note.trim();
  return {
    horizon: 'long',
    title: event.title,
    event: true,
    targetDate: event.date,
    eventId: event.id,
    weight: stored(d),
    ...(d.aim ? { aim: d.aim } : {}),
    ...(note ? { detail: note.slice(0, 500) } : {}),
    primary: d.weight === 'main',
    done: false,
  };
}

/** What changed on an event goal. */
export function eventGoalPatch(goal: Goal, d: CoachingDraft): GoalPatch {
  const note = d.note.trim();
  const unset: NonNullable<GoalPatch['unset']> = [];
  if (!d.aim && goal.aim) unset.push('aim');
  if (!note && goal.detail) unset.push('detail');
  return {
    weight: stored(d),
    primary: d.weight === 'main',
    ...(d.aim ? { aim: d.aim } : {}),
    ...(note ? { detail: note.slice(0, 500) } : {}),
    ...(unset.length ? { unset } : {}),
  };
}

/** "Important · Aim: Compete" — what the saved state and cards say. */
export function coachingSummary(goal: Pick<Goal, 'primary' | 'weight' | 'aim'>): string {
  return [EVENT_WEIGHT_LABEL[eventGoalWeight(goal)], goal.aim ? `Aim: ${EVENT_AIM_LABEL[goal.aim]}` : ''].filter(Boolean).join(' · ');
}

const pick = (on: boolean) => (on ? 'border-accent-ring bg-[#F4F9E4]' : 'border-line bg-surface');

/**
 * The questions. `showQ1` is off on the Athlete page, where the goal already exists. `otherMain` is the
 * current main goal's title, so picking Main goal says what it replaces. `hadGoal` changes what No says.
 */
export function CoachingFields({
  id,
  draft,
  set,
  showQ1 = true,
  otherMain,
  hadGoal = false,
}: {
  id: string;
  draft: CoachingDraft;
  set: (d: Partial<CoachingDraft>) => void;
  showQ1?: boolean;
  otherMain?: string | undefined;
  hadGoal?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {showQ1 && (
        <div className="flex flex-col gap-2">
          <span id={`${id}-q1`} className="text-sm font-semibold">
            Should your coach take this event into account when coaching and creating plans and workouts?
          </span>
          <div role="radiogroup" aria-labelledby={`${id}-q1`} className="grid grid-cols-2 gap-2">
            {(['yes', 'no'] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={draft.q1 === a}
                onClick={() => set({ q1: a })}
                className={`min-h-11 rounded-[10px] border-2 font-semibold text-ink ${pick(draft.q1 === a)}`}
              >
                {a === 'yes' ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
          {draft.q1 === 'no' && (
            <div className="text-[13px] text-muted">
              {hadGoal ? 'Saving removes the goal for this event. It stays on your calendar, and your coach plans around the day itself.' : 'It stays on your calendar, and your coach plans around the day itself.'}
            </div>
          )}
        </div>
      )}
      {(!showQ1 || draft.q1 === 'yes') && (
        <>
          <div className="flex flex-col gap-2">
            <span id={`${id}-q2`} className="text-sm font-semibold">
              How much weight should the coach give this event?
            </span>
            <div role="radiogroup" aria-labelledby={`${id}-q2`} className="flex flex-col gap-1.5">
              {(['main', 'important', 'in_mind'] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={draft.weight === w}
                  onClick={() => set({ weight: w })}
                  className={`flex min-h-11 flex-col rounded-[10px] border-2 px-3 py-1.5 text-left text-ink ${pick(draft.weight === w)}`}
                >
                  <span className="font-semibold">{EVENT_WEIGHT_LABEL[w]}</span>
                  <span className="text-[13px] text-muted">{EVENT_WEIGHT_BLURB[w]}</span>
                  {w === 'main' && otherMain && <span className="text-xs text-[#B54708]">Replaces ‘{otherMain}’ as your main goal.</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span id={`${id}-aim`} className="text-sm font-semibold">
              Your aim <span className="font-normal text-muted">· optional</span>
            </span>
            <div role="group" aria-labelledby={`${id}-aim`} className="flex flex-wrap gap-1.5">
              {eventAims.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={draft.aim === a}
                  onClick={() => set({ aim: draft.aim === a ? null : a })}
                  className={`min-h-[34px] rounded-full border px-3 text-[13px] font-semibold ${draft.aim === a ? 'border-accent-ring bg-accent-tint text-[#2F4A0D]' : 'border-line-strong bg-surface text-ink'}`}
                >
                  {EVENT_AIM_LABEL[a]}
                </button>
              ))}
            </div>
            <label htmlFor={`${id}-note`} className="sr-only">
              Aim note
            </label>
            <input
              id={`${id}-note`}
              value={draft.note}
              maxLength={500}
              placeholder="e.g. Under 5 hours. Stay with the front group to the last climb."
              onChange={(e) => set({ note: e.target.value })}
              className="min-h-10 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink"
            />
          </div>
        </>
      )}
    </div>
  );
}
