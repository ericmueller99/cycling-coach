import type { IsoDate, Memory } from '@cycling-coach/shared';
import { addDays, daysBetween } from './dates';

/**
 * The two kinds of coach memory (DECISIONS #79). A note with an `until` date is short-term: it reaches
 * the coach until the day after that date, then it's forgotten. A note without one is long-term: it's
 * always sent, and after a while the athlete is asked whether it's still true.
 */

/** A note outlives its date by this much, so the coach can still say "how was the trip?". */
const GRACE_DAYS = 1;
/** How long a long-term note goes without a look before the panel asks if it's still true. */
export const REVIEW_AFTER_DAYS = 180;
const MAX_UNTIL_DAYS = 365;

type Dated = Pick<Memory, 'until'>;

export const isShortTerm = (m: Dated): boolean => m.until !== undefined;

export const isExpired = (m: Dated, today: IsoDate): boolean => m.until !== undefined && today > addDays(m.until, GRACE_DAYS);

/** The short-term notes the coach should see today. */
export const activeShortTerm = <T extends Dated>(memories: T[], today: IsoDate): T[] =>
  memories.filter((m) => isShortTerm(m) && !isExpired(m, today));

/** Long-term notes and live short-term ones: everything the athlete should see. */
export const visibleMemories = <T extends Dated>(memories: T[], today: IsoDate): T[] => memories.filter((m) => !isExpired(m, today));

export function needsReview(m: Pick<Memory, 'until' | 'createdAt' | 'reviewedAt'>, today: IsoDate): boolean {
  if (isShortTerm(m)) return false;
  return daysBetween((m.reviewedAt ?? m.createdAt).slice(0, 10), today) >= REVIEW_AFTER_DAYS;
}

/** Why a date can't be a note's `until`, or null when it can. `isoDateSchema` only checks the shape. */
export function checkUntil(until: IsoDate, today: IsoDate): string | null {
  if (addDays(until, 0) !== until) return `${until} isn't a real date.`;
  if (until < today) return `${until} has already passed.`;
  if (daysBetween(today, until) > MAX_UNTIL_DAYS) return 'Short-term notes can run for a year at most.';
  return null;
}
