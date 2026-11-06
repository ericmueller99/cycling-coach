import type { UiBlock } from '@cycling-coach/shared';
import { useEffect, useState } from 'react';
import type { LiveTurn } from '../../lib/coachTurn';
import { modelName } from '../../lib/models';

/** What the coach is doing, in words, while a tool runs. */
const TOOL_LABELS: Record<string, string> = {
  build_recipe: 'Writing the recipe',
  suggest_meals: 'Finding meal ideas',
  get_recent_activities: 'Pulling your rides',
  search_activities: 'Searching your rides',
  get_activity_detail: 'Reading the ride',
  get_fitness: 'Checking your fitness',
  get_power_curve: 'Reading your power curve',
  get_calendar: 'Checking your calendar',
  get_ride_feedback: 'Reading your ride notes',
  find_events: 'Looking for events',
  create_workout: 'Building the workout',
  propose_plan: 'Drafting the plan',
  propose_calendar_changes: 'Drafting calendar changes',
  propose_time_off: 'Updating your time off',
};

/** Blocks the athlete reads and acts on. After one, the coach is only adding its closing words. */
const CARDS: readonly UiBlock['type'][] = ['proposal', 'workout', 'meal_ideas', 'recipe_ref', 'food_log_offer'];

/** Seconds since `since`, ticking. */
function useElapsed(since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

function label(turn: LiveTurn) {
  if (turn.runningTool) return TOOL_LABELS[turn.runningTool] ?? 'Working';
  if (turn.writing) return 'Writing';
  const last = turn.blocks.at(-1);
  if (last && CARDS.includes(last.type)) return 'Finishing up';
  if (!turn.model) return 'Thinking';
  return turn.model.fallback ? `Carrying on with ${modelName(turn.model.id)}` : `Building with ${modelName(turn.model.id)}`;
}

/** The 4-spoke wheel on the lime tile (DESIGN 15), turning once every 1.1 s. */
function TurningWheel() {
  return (
    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-accent text-on-accent" aria-hidden>
      <svg viewBox="0 0 32 32" width="20" height="20" className="animate-spin [animation-duration:1.1s] motion-reduce:animate-none">
        <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="4" />
        <path d="M16 6 L16 26 M6 16 L26 16 M9 9 L23 23 M23 9 L9 23" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="3.6" fill="currentColor" />
      </svg>
    </span>
  );
}

/**
 * The coach is working (DECISIONS #46, #84): a turning wheel, what it's doing and, after a few
 * seconds, how long it's been. Beside the composer for the whole turn, so it's on screen wherever
 * the athlete has scrolled to, and it never moves the page.
 */
export function CoachWorking({ turn }: { turn: LiveTurn }) {
  const secs = useElapsed(turn.startedAt);
  return (
    <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-ink">
      <TurningWheel />
      <span className="truncate">{label(turn)}…</span>
      {secs >= 5 && (
        <span className="font-mono text-xs font-normal text-muted" aria-hidden>
          {secs}s
        </span>
      )}
    </div>
  );
}
