import { rpeBand, rpeWord, type RpeBand } from '@cycling-coach/core';
import type { CalendarEvent, SessionFeedback } from '@cycling-coach/shared';

/** RPE colours by band: the selected button and the text, plus a tint for chip pills. */
export const RPE_STYLE: Record<RpeBand, { fg: string; tint: string }> = {
  easy: { fg: '#15803D', tint: '#D3F8DF' },
  moderate: { fg: '#8A6100', tint: '#FFF4D6' },
  hard: { fg: '#B54708', tint: '#FFF1E8' },
  max: { fg: '#B42318', tint: '#FEE4E2' },
};

export const rpeStyle = (rpe: number) => RPE_STYLE[rpeBand(rpe)];

/** "RPE 7 · Hard" — the chip pill. */
export const rpePill = (rpe: number) => `RPE ${rpe} · ${rpeWord(rpe)}`;

/** The completed-session colours (green chip, status pill, result banner). */
export const COMPLETED = { bg: '#ECFDF3', border: '#ABEFC6', fg: '#085D3A' };

/** Ratings in a calendar range, found by session or by ride. */
export interface FeedbackIndex {
  byEvent: Map<string, SessionFeedback>;
  byActivity: Map<string, SessionFeedback>;
}

export function indexFeedback(list: readonly SessionFeedback[]): FeedbackIndex {
  return {
    byEvent: new Map(list.flatMap((f) => (f.eventId ? [[f.eventId, f] as const] : []))),
    byActivity: new Map(list.flatMap((f) => (f.activityId ? [[f.activityId, f] as const] : []))),
  };
}

/** A session's rating — or its ride's, when the ride was rated before the sync matched them. */
export function feedbackForEvent(index: FeedbackIndex, e: Pick<CalendarEvent, 'id' | 'activityId'>): SessionFeedback | undefined {
  return index.byEvent.get(e.id) ?? (e.activityId ? index.byActivity.get(e.activityId) : undefined);
}
