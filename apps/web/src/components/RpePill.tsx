import type { SessionFeedback } from '@cycling-coach/shared';
import { rpePill, rpeStyle } from '../lib/feedback';

/**
 * The rating pill on a calendar chip: "RPE 7 · Hard" in its band's
 * colour once rated, a lime "Rate it" on an unrated completed session, nothing otherwise.
 */
export function RpePill({ feedback, prompt = false, className = '' }: { feedback: SessionFeedback | undefined; prompt?: boolean; className?: string }) {
  if (!feedback && !prompt) return null;
  const style = feedback ? { background: rpeStyle(feedback.rpe).tint, color: rpeStyle(feedback.rpe).fg } : { background: '#C8F25A', color: '#0E1014' };
  return (
    <span className={`inline-block shrink-0 rounded-[5px] px-1.5 text-[10px] leading-[17px] font-bold whitespace-nowrap ${className}`} style={style}>
      {feedback ? rpePill(feedback.rpe) : 'Rate it'}
    </span>
  );
}
