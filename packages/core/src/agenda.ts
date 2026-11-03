import type { CalendarActivity, CalendarEvent, IsoDate } from '@cycling-coach/shared';

/** One calendar day: its sessions, the rides no session claimed, and minutes ridden in total. */
export interface CalendarDay {
  events: CalendarEvent[];
  rides: CalendarActivity[];
  ridden: number;
}

/** Sessions and rides by local date — the calendar grid and the mobile agenda draw from this. */
export function groupByDay(events: readonly CalendarEvent[], activities: readonly CalendarActivity[]): Map<IsoDate, CalendarDay> {
  const m = new Map<IsoDate, CalendarDay>();
  const day = (d: IsoDate) => {
    let entry = m.get(d);
    if (!entry) m.set(d, (entry = { events: [], rides: [], ridden: 0 }));
    return entry;
  };
  for (const e of events) day(e.date).events.push(e);
  for (const a of activities) {
    const d = day(a.startLocal.slice(0, 10));
    d.ridden += a.movingSec / 60;
    if (!a.matchedEventId) d.rides.push(a);
  }
  return m;
}

/**
 * A week at a glance: minutes (past days count what was ridden, today onwards what's planned,
 * skipped sessions excluded), sessions done (plus rides nothing planned) and sessions still planned.
 */
export function weekSummary(dates: readonly IsoDate[], today: IsoDate, byDay: ReadonlyMap<IsoDate, CalendarDay>) {
  let minutes = 0;
  let done = 0;
  let planned = 0;
  for (const d of dates) {
    const day = byDay.get(d);
    if (!day) continue;
    minutes += d < today ? day.ridden : day.events.filter((e) => e.status !== 'skipped').reduce((s, e) => s + (e.durationMin ?? 0), 0);
    done += day.events.filter((e) => e.status === 'done').length + day.rides.length;
    planned += day.events.filter((e) => e.status === 'planned').length;
  }
  return { minutes: Math.round(minutes), done, planned };
}
