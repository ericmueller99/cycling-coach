import type { SessionFeedback } from '@cycling-coach/shared';

/** Scale words: 1–2 Very easy, 3–4 Easy, 5–6 Moderate, 7–8 Hard, 9 Very hard, 10 Max. */
const RPE_WORDS = ['', 'Very easy', 'Very easy', 'Easy', 'Easy', 'Moderate', 'Moderate', 'Hard', 'Hard', 'Very hard', 'Max'] as const;

export function rpeWord(rpe: number): string {
  return RPE_WORDS[Math.min(10, Math.max(1, Math.round(rpe)))]!;
}

/** Colour band for an RPE: 1–4 easy, 5–6 moderate, 7–8 hard, 9–10 max. */
export type RpeBand = 'easy' | 'moderate' | 'hard' | 'max';

export function rpeBand(rpe: number): RpeBand {
  return rpe <= 4 ? 'easy' : rpe <= 6 ? 'moderate' : rpe <= 8 ? 'hard' : 'max';
}

const NOTE_MAX = 240;

/** The athlete's note on one line, clipped for the coach. */
function clipNote(note: string | undefined): string | undefined {
  const flat = note?.replace(/\s+/g, ' ').trim();
  return flat && flat.length > NOTE_MAX ? `${flat.slice(0, NOTE_MAX - 1)}…` : flat;
}

/** A rating has an RPE; a feedback doc without one is a missed or skipped session's reason (DECISIONS #97). */
export function isRating<T extends Pick<SessionFeedback, 'rpe'>>(fb: T): fb is T & { rpe: number } {
  return fb.rpe !== undefined;
}

/** A feedback doc with an RPE: a ride's rating. */
export type Rating = SessionFeedback & { rpe: number };

/** `RPE 7/10 (Hard) · "First two felt easy…"` — the one way the coach sees a rating. */
export function describeFeedback(fb: Pick<SessionFeedback, 'note'> & { rpe: number }): string {
  const clipped = clipNote(fb.note);
  return `RPE ${fb.rpe}/10 (${rpeWord(fb.rpe)})${clipped ? ` · "${clipped}"` : ''}`;
}

/** `"Sick with a cold"` — why a session didn't happen, in the athlete's words. Empty when there's no note. */
export function describeReason(fb: Pick<SessionFeedback, 'note'>): string {
  const clipped = clipNote(fb.note);
  return clipped ? `"${clipped}"` : '';
}
