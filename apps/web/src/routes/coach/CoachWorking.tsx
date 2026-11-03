import { useEffect, useState } from 'react';
import type { LiveTurn } from '../../lib/coachTurn';

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
};

/** Seconds since `since`, ticking. */
function useElapsed(since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * The coach is working (DECISIONS #46): bouncing dots, what it's doing and, after a few seconds,
 * how long it's been. Shown for the whole turn except while the reply text is streaming in.
 */
export function CoachWorking({ turn }: { turn: LiveTurn }) {
  const secs = useElapsed(turn.startedAt);
  const label = turn.runningTool ? (TOOL_LABELS[turn.runningTool] ?? 'Working') : turn.thinking || !turn.writing ? 'Thinking' : null;
  if (!label) return null;
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 self-start rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-muted">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </span>
      <span>
        {label}…{secs >= 5 && <span className="ml-1.5 font-mono text-xs">{secs}s</span>}
      </span>
    </div>
  );
}
