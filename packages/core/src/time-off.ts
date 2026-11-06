import type { CalendarEvent, IsoDate, TimeOff } from '@cycling-coach/shared';

type Span = Pick<TimeOff, 'startDate' | 'endDate'>;

/** The entries that cover a day. Time off can overlap: getting sick on vacation is real. */
export function timeOffOn<T extends Span>(entries: readonly T[], date: IsoDate): T[] {
  return entries.filter((e) => e.startDate <= date && date <= e.endDate);
}

/** Where a day falls in an entry, so a chip can run on into the next day. */
export function spanPosition(entry: Span, date: IsoDate): 'single' | 'start' | 'middle' | 'end' {
  if (entry.startDate === entry.endDate) return 'single';
  if (date === entry.startDate) return 'start';
  return date === entry.endDate ? 'end' : 'middle';
}

/**
 * The sessions time off would get in the way of: still planned, on a day that hasn't passed.
 * Both the warning on a manual add and the coach's offer to remove them use this.
 */
export function sessionsInSpan<T extends Pick<CalendarEvent, 'date' | 'status'>>(events: readonly T[], start: IsoDate, end: IsoDate, today: IsoDate): T[] {
  return events.filter((e) => e.status === 'planned' && e.date >= start && e.date <= end && e.date >= today);
}
