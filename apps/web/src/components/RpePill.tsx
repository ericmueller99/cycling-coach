import { isRating } from '@cycling-coach/core';
import type { SessionFeedback } from '@cycling-coach/shared';
import { rpePill, rpeStyle } from '../lib/feedback';

/**
 * The rating pill on a calendar chip: "RPE 7 · Hard" in its band's
 * colour once rated, a lime "Rate it" on an unrated completed session, nothing otherwise. A missed
 * session's reason, left behind when it was ridden after all, isn't a rating (DECISIONS #97).
 */
export function RpePill({ feedback: stored, prompt = false, className = '' }: { feedback: SessionFeedback | undefined; prompt?: boolean; className?: string }) {
  const feedback = stored && isRating(stored) ? stored : undefined;
  if (!feedback && !prompt) return null;
  const style = feedback ? { background: rpeStyle(feedback.rpe).tint, color: rpeStyle(feedback.rpe).fg } : { background: '#C8F25A', color: '#0E1014' };
  const label = feedback ? rpePill(feedback.rpe) : 'Rate it';
  // max-w-full + truncate: in a narrow day cell (day panel open) it ends in "…" instead of spilling over.
  return (
    <span className={`inline-block max-w-full shrink-0 truncate rounded-[5px] px-1.5 text-[10px] leading-[17px] font-bold ${className}`} style={style} title={label}>
      {label}
    </span>
  );
}
