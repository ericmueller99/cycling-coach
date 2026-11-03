import type { FoodLogEntry } from '@cycling-coach/shared';

/** The slot that holds food eaten on the bike; "Ride fuel" was its old name. */
export const isFuelSlot = (slot: string) => /workout fuel|ride fuel/i.test(slot);

/** Where a session with no start time sits on the day's timeline. */
export const UNTIMED_SESSION_TIME = '12:00';

export interface TimelineMeal {
  kind: 'meal';
  slot: string;
  /** Earliest entry time, else the slot's usual time. */
  time?: string | undefined;
  entries: FoodLogEntry[];
  kcal: number;
}
export interface TimelineSession<S> {
  kind: 'session';
  session: S;
  time?: string | undefined;
  /** The day's Workout fuel, nested under the session it was eaten on. */
  fuel?: TimelineMeal | undefined;
}
export type TimelineItem<S> = TimelineMeal | TimelineSession<S> | { kind: 'now'; time: string };

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * One day of meals and sessions in time order (the day panel, day view and phone day).
 * Meals sort by their earliest entry, else the slot's time; sessions by their start, else midday.
 * Workout fuel nests under the session nearest its time (the first one when untimed); with no
 * session it stays a meal of its own. `includeEmpty` keeps slots with nothing logged (the day view
 * offers to add to them). `now` adds a "now" marker (today); a `pending` session (not ridden yet)
 * whose time is unknown or already past sits just below it, since that's when it can still happen.
 */
export function dayTimeline<S extends { time?: string | undefined; pending?: boolean | undefined }>(i: {
  entries: readonly FoodLogEntry[];
  slots: readonly { name: string; time?: string | undefined }[];
  sessions: readonly S[];
  now?: string | undefined;
  includeEmpty?: boolean | undefined;
}): TimelineItem<S>[] {
  const bySlot = new Map<string, FoodLogEntry[]>();
  for (const e of i.entries) bySlot.set(e.slot, [...(bySlot.get(e.slot) ?? []), e]);
  const names = [...i.slots.map((s) => s.name), ...[...bySlot.keys()].filter((n) => !i.slots.some((s) => s.name === n)).sort()];

  const meals: TimelineMeal[] = [];
  for (const slot of names) {
    const entries = [...(bySlot.get(slot) ?? [])].sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
    if (!entries.length && !i.includeEmpty) continue;
    const time = entries.find((e) => e.time)?.time ?? i.slots.find((s) => s.name === slot)?.time;
    meals.push({ kind: 'meal', slot, time, entries, kcal: Math.round(entries.reduce((n, e) => n + e.nutrients.kcal, 0)) });
  }

  const sessions: TimelineSession<S>[] = i.sessions.map((session) => ({ kind: 'session', session, time: session.time }));
  const fuelIndex = meals.findIndex((m) => isFuelSlot(m.slot));
  if (fuelIndex >= 0 && sessions.length) {
    const fuel = meals.splice(fuelIndex, 1)[0]!;
    const at = fuel.entries.find((e) => e.time)?.time;
    const host = at
      ? sessions.reduce((best, s) => (Math.abs(minutes(s.time ?? UNTIMED_SESSION_TIME) - minutes(at)) < Math.abs(minutes(best.time ?? UNTIMED_SESSION_TIME) - minutes(at)) ? s : best))
      : sessions[0]!;
    host.fuel = fuel;
  }

  // Meals keep slot order among themselves when they have no time; sessions go mid-day, or just
  // after "now" while still to do.
  const items: { item: TimelineItem<S>; at: number; order: number }[] = [];
  let lastMeal = 0;
  meals.forEach((m, n) => {
    lastMeal = m.time ? minutes(m.time) : lastMeal;
    items.push({ item: m, at: m.time ? minutes(m.time) : lastMeal, order: n });
  });
  const now = i.now ? minutes(i.now) : undefined;
  sessions.forEach((s, n) => {
    const at = s.time ? minutes(s.time) : undefined;
    if (now !== undefined && s.session.pending && (at === undefined || at < now)) items.push({ item: s, at: now, order: 1001 + n });
    else items.push({ item: s, at: at ?? minutes(UNTIMED_SESSION_TIME), order: 100 + n });
  });
  if (i.now) items.push({ item: { kind: 'now', time: i.now }, at: minutes(i.now), order: 1000 });
  return items.sort((a, b) => a.at - b.at || a.order - b.order).map((x) => x.item);
}
