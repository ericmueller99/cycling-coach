import type { IsoDate } from '@cycling-coach/shared';

/**
 * Calendar maths on `YYYY-MM-DD` strings. Dates are the athlete's local days and carry no zone, so
 * everything is done in UTC on the date parts — never through a local-time `Date`, which would shift
 * days across DST and time zones.
 */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function toUtc(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Monday = 0 … Sunday = 6 (the calendar is Monday-start). */
export function weekdayIndex(iso: IsoDate): number {
  return (toUtc(iso).getUTCDay() + 6) % 7;
}

export function weekStart(iso: IsoDate): IsoDate {
  return addDays(iso, -weekdayIndex(iso));
}

export function weekDates(iso: IsoDate): IsoDate[] {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Monday-start weeks covering the whole month (5 or 6 rows). `month` is 1–12. */
export function monthGrid(year: number, month: number): IsoDate[][] {
  const first = fromUtc(new Date(Date.UTC(year, month - 1, 1)));
  const lastDay = fromUtc(new Date(Date.UTC(year, month, 0)));
  const weeks: IsoDate[][] = [];
  for (let start = weekStart(first); start <= lastDay; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

/** The athlete's local date at instant `now`. */
export function todayIn(timeZone: string, now: Date): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function dayOfMonth(iso: IsoDate): number {
  return toUtc(iso).getUTCDate();
}

export function monthOf(iso: IsoDate): { year: number; month: number } {
  const d = toUtc(iso);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** "Thu 29" — plan card rows and week strips. */
export function formatDayLabel(iso: IsoDate): string {
  return `${DOW[weekdayIndex(iso)]} ${dayOfMonth(iso)}`;
}

/** "Thu Oct 29" */
export function formatLongDay(iso: IsoDate): string {
  const d = toUtc(iso);
  return `${DOW[weekdayIndex(iso)]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Oct 29" */
export function formatShortDate(iso: IsoDate): string {
  const d = toUtc(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Oct 29 – Nov 8" */
export function formatRange(from: IsoDate, to: IsoDate): string {
  return `${formatShortDate(from)} – ${formatShortDate(to)}`;
}

export function formatMonthTitle(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

export const WEEKDAY_LABELS = DOW;
