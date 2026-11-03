import { combineRides, formatLongDay, sessionRideIds } from '@cycling-coach/core';
import type { CalendarActivity, CalendarEvent } from '@cycling-coach/shared';

export const intervalsUrl = (activityId: string) => `https://intervals.icu/activities/${activityId}`;

/**
 * Beside the grid on wide screens — the page is locked to the viewport, so the panel fills the
 * height and scrolls on its own; a bottom sheet below `lg`, since the grid never ends.
 */
export const PANEL =
  'fixed inset-x-0 bottom-0 z-30 box-border flex max-h-[70dvh] min-w-0 flex-col gap-4 overflow-y-auto border-t border-line bg-surface-alt p-5 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] ' +
  'lg:static lg:max-h-none lg:w-[420px] lg:shrink-0 lg:self-stretch lg:border-t-0 lg:border-l lg:shadow-none';

/** The on-demand review: "Review my <session> on <day> (…): " — the coach sees the rating in its data. */
export const askCoachPrompt = (title: string, date: string, ref: string) => `Review my ${title} on ${formatLongDay(date)} (${ref}): did it feel right for what it was? `;

/** A ride's name without Zwift's "Zwift - " prefix. */
export const rideName = (a: Pick<CalendarActivity, 'name'>) => a.name.replace(/^Zwift - /, '');

/** "09:14" from a ride's local start. */
export const rideTime = (a: Pick<CalendarActivity, 'startLocal'>) => a.startLocal.slice(11, 16);

/** A session's rides (matched, then any grouped into it — DECISIONS #32) that the payload has, by start. */
export function sessionRides(e: CalendarEvent, ridesById: ReadonlyMap<string, CalendarActivity>): CalendarActivity[] {
  return sessionRideIds(e)
    .map((id) => ridesById.get(id))
    .filter((a): a is CalendarActivity => !!a)
    .sort((a, b) => a.startLocal.localeCompare(b.startLocal));
}

/** "72 min · load 86", or "111 min · load 98 · 2 rides" for a session ridden in pieces. */
export function ridesMeta(rides: readonly CalendarActivity[]): string {
  if (!rides.length) return '';
  const t = combineRides(rides);
  return `${Math.round(t.movingSec / 60)} min${t.trainingLoad !== undefined ? ` · load ${t.trainingLoad}` : ''}${rides.length > 1 ? ` · ${rides.length} rides` : ''}`;
}
