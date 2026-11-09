import { eventStats, formatHoursMinutes, formatLongDay, untilText } from '@cycling-coach/core';
import type { CalendarEvent, IsoDate } from '@cycling-coach/shared';
import { fmtTime } from './food';

/** "in 10 days", "in 44 weeks", "tomorrow"; empty once the day has passed (`core.untilText`). */
export const untilLabel = untilText;

/** "Tue Nov 17 · in 10 days" near, "Sat May 15, 2027" further off: the rail's Coming up. */
export function comingUpWhen(date: IsoDate, today: IsoDate): string {
  const until = untilText(date, today);
  return until && !until.includes('weeks') ? `${formatLongDay(date)} · ${until}` : `${formatLongDay(date)}, ${date.slice(0, 4)}`;
}

/** "Sat Sep 11, 2027 · 7:00 AM · in 44 weeks" — the event panel's first line. */
export function eventWhen(e: Pick<CalendarEvent, 'date' | 'startTime'>, today: IsoDate): string {
  return [`${formatLongDay(e.date)}, ${e.date.slice(0, 4)}`, e.startTime ? fmtTime(e.startTime) : '', untilLabel(e.date, today)].filter(Boolean).join(' · ');
}

/** "142 km · 2,350 m · 7:00" — an event's chip says what the day is, not how it syncs. */
export function eventChipMeta(e: Pick<CalendarEvent, 'eventInfo' | 'startTime'>): string {
  return [eventStats(e.eventInfo), e.startTime?.replace(/^0(?=\d:)/, '')].filter(Boolean).join(' · ');
}

/** "~5 h 30", or empty with no estimate. Every event time is an estimate. */
export function estimateText(minutes: number | undefined): string {
  return minutes ? `~${formatHoursMinutes(minutes)}` : '';
}

/** A link as the athlete typed it ("coastrangefondo.example"), made clickable. */
export function eventHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** A link without its scheme, for showing. */
export function eventLinkText(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
