import { EVENT_TYPE_SHORT, type CalendarEvent, type EventInfo, type Goal, type IsoDate } from '@cycling-coach/shared';
import { daysBetween, formatLongDay } from './dates';

/**
 * Real-world events (DECISIONS #98): a race ridden outdoors, usually with `eventInfo`. A race imported
 * from intervals.icu as an outdoor ride has no details yet, but it's still an event, not a Zwift race.
 */
export function isEventSession(e: Pick<CalendarEvent, 'kind' | 'platform' | 'eventInfo'>): boolean {
  return e.kind === 'race' && (!!e.eventInfo || e.platform === 'garmin');
}

/** "142 km", "40.5 km". */
export function formatKm(km: number): string {
  return `${Math.round(km * 10) / 10} km`;
}

/** "2,350 m". */
export function formatMeters(m: number): string {
  return `${Math.round(m).toLocaleString('en-US')} m`;
}

/** "142 km · 2,350 m", or whichever of the two is known; empty when neither is. */
export function eventStats(info: Pick<EventInfo, 'distanceKm' | 'ascentM'> | undefined): string {
  if (!info) return '';
  return [info.distanceKm !== undefined ? formatKm(info.distanceKm) : '', info.ascentM ? formatMeters(info.ascentM) : ''].filter(Boolean).join(' · ');
}

/** "Gran fondo · 142 km · 2,350 m". */
export function describeEventInfo(info: EventInfo): string {
  return [EVENT_TYPE_SHORT[info.type], eventStats(info)].filter(Boolean).join(' · ');
}

/** "5 h 30", "5 h", "45 min". */
export function formatHoursMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

/**
 * An estimated time as people type it, in minutes: "~5 h 30", "5h30", "5:30", "5.5 h", "330 min",
 * "330m". A bare number is hours up to 24 and minutes above that, since nobody plans a 20-minute
 * event or a 300-hour one. Null when it isn't a time.
 */
export function parseDurationText(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/^~\s*/, '').replace(/\s+/g, ' ');
  if (!t) return null;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?) ?h(?:ours?|rs?)?(?: ?(\d{1,2}) ?(?:m|min|mins)?)?$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60) + (m[2] ? Number(m[2]) : 0);
  m = /^(\d+) ?(?:m|min|mins|minutes)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^\d+(?:\.\d+)?$/.exec(t);
  if (m) {
    const n = Number(t);
    return n <= 24 ? Math.round(n * 60) : Math.round(n);
  }
  return null;
}

/** "in 10 days", "in 44 weeks", "tomorrow", "today"; empty once the day has passed. */
export function untilText(date: IsoDate, today: IsoDate): string {
  const days = daysBetween(today, date);
  if (days < 0) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}

/** "Sat Sep 11 2027": a far-off date needs its year. */
export const formatLongDate = (date: IsoDate) => `${formatLongDay(date)} ${date.slice(0, 4)}`;

/**
 * The events the coach keeps in view however far off (DECISIONS #101): real-world events, any race the
 * athlete has a goal for, and A races. Zwift C races without a goal stay in the two-week calendar only.
 * Skipped ones are left out. In date order.
 */
export function coachEvents<E extends Pick<CalendarEvent, 'id' | 'date' | 'kind' | 'platform' | 'eventInfo' | 'priority' | 'status'>>(
  events: readonly E[],
  goals: readonly Pick<Goal, 'eventId'>[],
): E[] {
  const goalFor = new Set(goals.flatMap((g) => (g.eventId ? [g.eventId] : [])));
  return events
    .filter((e) => e.kind === 'race' && e.status !== 'skipped' && (isEventSession(e) || goalFor.has(e.id) || e.priority === 'A'))
    .sort((a, b) => a.date.localeCompare(b.date));
}
