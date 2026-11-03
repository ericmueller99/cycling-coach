import {
  DEFAULT_EVENT_FILTERS,
  eventFiltersSchema,
  eventQuerySchema,
  type CalendarEventInput,
  type EventFilters,
  type EventItem,
  type EventSort,
  type Terrain,
  type TimeOfDay,
  type UnlockKind,
  type ZwiftEventPen,
  type ZwiftEventType,
} from '@cycling-coach/shared';
import { todayIn } from '@cycling-coach/core';

/** Event-type colours. TT and TTT share a purple the session tags don't have. */
export const TYPE_STYLE: Record<ZwiftEventType, { label: string; fg: string; bg: string; dot: string }> = {
  race: { label: 'Race', fg: '#B42318', bg: 'rgba(239,68,68,.12)', dot: '#EF4444' },
  group_ride: { label: 'Group ride', fg: '#1D5BBF', bg: 'rgba(59,139,246,.12)', dot: '#3B8BF6' },
  workout: { label: 'Workout', fg: '#B54708', bg: 'rgba(245,120,42,.14)', dot: '#F5782A' },
  tt: { label: 'TT', fg: '#6941C6', bg: 'rgba(105,65,198,.12)', dot: '#7F56D9' },
  ttt: { label: 'TTT', fg: '#6941C6', bg: 'rgba(105,65,198,.12)', dot: '#7F56D9' },
};

export const TERRAIN: Record<Terrain, { label: string; hint: string }> = {
  flat: { label: 'Flat', hint: '< 5 m/km' },
  rolling: { label: 'Rolling', hint: '5–10 m/km' },
  hilly: { label: 'Hilly', hint: '10–20 m/km' },
  mountain: { label: 'Mountain', hint: '20+ m/km' },
};

export const TIMES_OF_DAY: { key: TimeOfDay; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'midday', label: 'Midday' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

export const UNLOCKS: { key: UnlockKind; label: string }[] = [
  { key: 'kit', label: 'Jersey / kit' },
  { key: 'badge', label: 'Badge' },
  { key: 'route_badge', label: 'Route badge' },
  { key: 'bike', label: 'Bike / wheels' },
];

export const SERIES: { key: EventFilters['series'][number]; label: string }[] = [
  { key: 'zrl', label: 'Zwift Racing League' },
  { key: 'tour_of_watopia', label: 'Tour of Watopia' },
  { key: 'zfondo', label: 'zFondo' },
  { key: 'pacer', label: 'Pacer rides' },
];

export const SORTS: { key: EventSort; label: string; group: string }[] = [
  { key: 'start', label: 'Start time', group: '' },
  { key: 'pop', label: 'Most popular', group: 'Most popular' },
  { key: 'km', label: 'Longest', group: 'Longest first' },
  { key: 'elev', label: 'Most climbing', group: 'Most climbing first' },
];

/** Length presets per unit: [label, min, max). */
export const LENGTH_PRESETS: Record<EventFilters['lengthUnit'], [string, number | undefined, number | undefined][]> = {
  km: [
    ['< 30 km', undefined, 30],
    ['30–60', 30, 60],
    ['60–100', 60, 100],
    ['100+ km', 100, undefined],
  ],
  min: [
    ['< 45 min', undefined, 45],
    ['45–60', 45, 60],
    ['60–90', 60, 90],
    ['90+ min', 90, undefined],
  ],
};

export const POPULARITY = [10, 25, 50];

/** Filters with one field changed — `undefined` removes an optional field. */
export function withFilter<K extends keyof EventFilters>(f: EventFilters, key: K, value: EventFilters[K] | undefined): EventFilters {
  const next = { ...f };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export const toggle = <T>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export interface ActiveChip {
  key: string;
  label: string;
  clear: (f: EventFilters) => EventFilters;
}

const lengthLabel = (f: EventFilters) => {
  const preset = LENGTH_PRESETS[f.lengthUnit].find(([, lo, hi]) => lo === f.lengthMin && hi === f.lengthMax);
  if (preset) return preset[0].includes(f.lengthUnit === 'km' ? 'km' : 'min') ? preset[0] : `${preset[0]} ${f.lengthUnit}`;
  const unit = f.lengthUnit === 'km' ? 'km' : 'min';
  if (f.lengthMin !== undefined && f.lengthMax !== undefined) return `${f.lengthMin}–${f.lengthMax} ${unit}`;
  return f.lengthMin !== undefined ? `${f.lengthMin}+ ${unit}` : `< ${f.lengthMax} ${unit}`;
};

/** One removable chip per filter that differs from the defaults (results toolbar). */
export function activeChips(f: EventFilters): ActiveChip[] {
  const d = DEFAULT_EVENT_FILTERS;
  const chips: ActiveChip[] = [];
  const add = (key: string, label: string, clear: (f: EventFilters) => EventFilters) => chips.push({ key, label, clear });
  if (f.q) add('q', `“${f.q}”`, (x) => ({ ...x, q: '' }));
  if (f.upcoming !== d.upcoming) add('upcoming', 'Incl. started events', (x) => ({ ...x, upcoming: d.upcoming }));
  if (f.day !== 'all') add('day', f.day === 'today' ? 'Today' : 'Tomorrow', (x) => ({ ...x, day: 'all' }));
  for (const t of f.timesOfDay) add(`tod-${t}`, TIMES_OF_DAY.find((x) => x.key === t)!.label, (x) => ({ ...x, timesOfDay: x.timesOfDay.filter((y) => y !== t) }));
  if (f.from || f.to) add('time', `${f.from ?? '…'}–${f.to ?? '…'}`, (x) => withFilter(withFilter(x, 'from', undefined), 'to', undefined));
  for (const t of f.types) add(`type-${t}`, TYPE_STYLE[t].label, (x) => ({ ...x, types: x.types.filter((y) => y !== t) }));
  if (f.lengthMin !== undefined || f.lengthMax !== undefined) add('length', lengthLabel(f), (x) => withFilter(withFilter(x, 'lengthMin', undefined), 'lengthMax', undefined));
  for (const t of f.terrain) add(`terrain-${t}`, TERRAIN[t].label, (x) => ({ ...x, terrain: x.terrain.filter((y) => y !== t) }));
  for (const w of f.worlds) add(`world-${w}`, w, (x) => ({ ...x, worlds: x.worlds.filter((y) => y !== w) }));
  if (f.route) add('route', `Route: ${f.route}`, (x) => withFilter(x, 'route', undefined));
  if (f.minSignedUp) add('pop', `${f.minSignedUp}+ signed up`, (x) => ({ ...x, minSignedUp: 0 }));
  if (f.friends) add('friends', 'Friends in', (x) => ({ ...x, friends: false }));
  if (f.canEnter !== d.canEnter) add('canEnter', f.canEnter ? 'I can enter' : 'Incl. events I can’t enter', (x) => ({ ...x, canEnter: d.canEnter }));
  if (f.fitsZ2) add('z2', 'Fits Z2', (x) => ({ ...x, fitsZ2: false }));
  if (f.hasUnlock) add('unlock', 'Has an unlock', (x) => ({ ...x, hasUnlock: false }));
  if (f.pens.length) add('pens', `Pen ${f.pens.join(', ')}`, (x) => ({ ...x, pens: [] }));
  for (const k of f.penKinds) add(`pk-${k}`, `${{ category: 'Category', pace: 'Pace', distance: 'Distance options', none: 'Single pen' }[k]} pens`, (x) => ({ ...x, penKinds: x.penKinds.filter((y) => y !== k) }));
  if (f.penBasis !== 'any') add('basis', f.penBasis === 'zftp' ? 'zFTP pens' : 'Racing Score pens', (x) => ({ ...x, penBasis: 'any' }));
  if (f.enforcedOnly) add('enforced', 'Category enforced', (x) => ({ ...x, enforcedOnly: false }));
  if (f.rankedOnly) add('ranked', 'Ranked', (x) => ({ ...x, rankedOnly: false }));
  if (f.powerups !== 'any') add('pu', f.powerups === 'no' ? 'No power-ups' : 'Power-ups', (x) => ({ ...x, powerups: 'any' }));
  if (f.lateJoin) add('late', 'Late join', (x) => ({ ...x, lateJoin: false }));
  if (f.noDrafting) add('draft', 'No drafting', (x) => ({ ...x, noDrafting: false }));
  if (f.ttBikes) add('tt', 'TT bikes allowed', (x) => ({ ...x, ttBikes: false }));
  if (f.hrmRequired) add('hrm', 'HRM required', (x) => ({ ...x, hrmRequired: false }));
  if (f.hideWomenOnly !== d.hideWomenOnly) add('women', 'Incl. women-only', (x) => ({ ...x, hideWomenOnly: d.hideWomenOnly }));
  for (const u of f.unlocks) add(`ul-${u}`, UNLOCKS.find((x) => x.key === u)!.label, (x) => ({ ...x, unlocks: x.unlocks.filter((y) => y !== u) }));
  for (const s of f.series) add(`series-${s}`, SERIES.find((x) => x.key === s)!.label, (x) => ({ ...x, series: x.series.filter((y) => y !== s) }));
  if (f.signedUpOnly) add('signed', 'Signed up', (x) => ({ ...x, signedUpOnly: false }));
  if (f.onCalendar) add('cal', 'On my calendar', (x) => ({ ...x, onCalendar: false }));
  return chips;
}

/** "6:00 PM" in the athlete's zone. */
export function timeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "Sat 9:00 PM", or "Fri Nov 6, 9:00 PM" beyond tomorrow. */
export function whenLabel(iso: string, timeZone: string, now: Date) {
  const d = new Date(iso);
  const days = (Date.parse(todayIn(timeZone, d)) - Date.parse(todayIn(timeZone, now))) / 86_400_000;
  const opts: Intl.DateTimeFormatOptions =
    days <= 1 ? { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' } : { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return new Intl.DateTimeFormat('en-US', opts).format(d);
}

/** "in 2 h", "in 25 min", "15 min ago"; a day or more ahead, its day ("Sat Nov 7"). */
export function relLabel(iso: string, now: Date, timeZone: string) {
  const min = Math.round((Date.parse(iso) - now.getTime()) / 60_000);
  if (min < 0) return `${-min} min ago`;
  if (min === 0) return 'now';
  if (min < 60) return `in ${min} min`;
  if (min < 24 * 60) return `in ${Math.round(min / 60)} h`;
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso)).replace(',', '');
}

export function agoLabel(iso: string | undefined, now: Date) {
  if (!iso) return 'never';
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** "45 min", "1 h 05". */
export function minutesLabel(min: number) {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Day group label: "Today · Sat Oct 31", "Tomorrow · Sun Nov 1", "Mon Nov 2". */
export function dayLabel(date: string, today: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const text = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(d).replace(',', '');
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  return diff === 0 ? `Today · ${text}` : diff === 1 ? `Tomorrow · ${text}` : text;
}

/** The pen a row's single-number stats describe: the athlete's, else the first. */
export function shownPen(e: EventItem): ZwiftEventPen | undefined {
  return e.pens.find((p) => p.id === e.me.myPenId) ?? e.pens[0];
}

const range = (xs: number[], fmt: (n: number) => string) => {
  if (!xs.length) return undefined;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
};

/** km / climbing / time for a row — ranges for distance options. */
export function statsOf(e: EventItem): { km?: string | undefined; elev?: string | undefined; terrain?: string | undefined; dur?: string | undefined } {
  if (e.penKind === 'distance') {
    const ests = e.pens.flatMap((p) => (p.estMin ? [p.estMin] : []));
    const matched = e.pens.find((p) => e.me.matchedPenIds.includes(p.id)) ?? e.pens[Math.floor(e.pens.length / 2)];
    return {
      km: range(e.pens.flatMap((p) => (p.km !== undefined ? [p.km] : [])), (n) => n.toFixed(1)),
      elev: range(e.pens.flatMap((p) => (p.ascentM !== undefined ? [p.ascentM] : [])), String),
      terrain: matched?.terrain && TERRAIN[matched.terrain].label,
      dur: ests.length ? `~${minutesLabel(Math.min(...ests))}${ests.length > 1 && Math.max(...ests) !== Math.min(...ests) ? ` – ${minutesLabel(Math.max(...ests))}` : ''}` : undefined,
    };
  }
  const p = shownPen(e);
  return {
    km: p?.km !== undefined ? p.km.toFixed(1) : undefined,
    elev: p?.ascentM !== undefined ? String(p.ascentM) : undefined,
    terrain: p?.terrain && TERRAIN[p.terrain].label,
    dur: p?.durationMin ? minutesLabel(p.durationMin) : p?.estMin ? `~${minutesLabel(p.estMin)}` : undefined,
  };
}

/** "Watopia · Tempus Fugit × 2" (laps left out for distance options — they differ). */
export function whereOf(e: EventItem) {
  const p = shownPen(e);
  const route = p?.route ?? e.route;
  const laps = e.penKind === 'distance' ? undefined : (p?.laps ?? e.laps);
  return [e.world, route && `${route}${laps && laps > 1 ? ` × ${laps}` : ''}`].filter(Boolean).join(' · ');
}

export interface Badge {
  text: string;
  fg: string;
  bg: string;
}

const RULE_BADGES: Record<string, string> = {
  NO_POWERUPS: 'No power-ups',
  NO_DRAFTING: 'No draft',
  ENFORCE_HRM: 'HRM required',
  ALLOWS_LATE_JOIN: 'Late join',
};

const UNLOCK_WORD: Record<UnlockKind, string> = { kit: 'kit', badge: 'badge', route_badge: 'route badge', bike: 'bike' };

export function badgesOf(e: EventItem): Badge[] {
  const grey = { fg: '#4B5563', bg: '#EEF0F3' };
  const out: Badge[] = [];
  if (e.me.signedUpPenIds.length) out.push({ text: 'You’re in', fg: '#15803D', bg: 'rgba(21,128,61,.10)' });
  if (e.womenOnly) out.push({ text: 'Women only', fg: '#B42318', bg: 'rgba(239,68,68,.10)' });
  else if (e.me.canEnter === false) out.push({ text: 'You can’t enter', fg: '#B42318', bg: 'rgba(239,68,68,.10)' });
  if (e.penKind === 'distance') out.push({ text: 'Distance options', fg: '#0E7468', bg: '#E6F6F4' });
  if (e.unlocks.length) out.push({ text: `Unlocks ${e.unlocks.map((u) => UNLOCK_WORD[u]).join(', ')}`, fg: '#5925DC', bg: '#F4F3FF' });
  if (e.me.fitsZ2) out.push({ text: 'Fits Z2', fg: '#1D5BBF', bg: 'rgba(59,139,246,.12)' });
  if (e.categoryEnforced) out.push({ text: 'Category enforced', ...grey });
  if (e.ranked) out.push({ text: 'Ranked', ...grey });
  for (const r of e.rules) if (RULE_BADGES[r]) out.push({ text: RULE_BADGES[r], ...grey });
  return out;
}

export interface PenNote {
  text: string;
  fg: string;
}

/** The line under the pens: whose pen, pace range, matching distance options. */
export function penNoteOf(e: EventItem): PenNote {
  const quiet = '#5B6472';
  if (e.womenOnly || e.me.canEnter === false) return { text: 'No pen for you', fg: '#B42318' };
  if (e.penKind === 'distance') {
    const matched = e.pens.filter((p) => e.me.matchedPenIds.includes(p.id));
    return matched.length ? { text: `Matches: ${matched.map((p) => p.name).join(', ')}`, fg: '#3F6212' } : { text: 'Open to all · pick a distance', fg: quiet };
  }
  if (e.penKind === 'none') return { text: e.type === 'tt' || e.type === 'ttt' ? 'Solo start' : 'Open to all', fg: quiet };
  if (e.penKind === 'pace') {
    const p = e.pens.find((x) => x.paceFrom && x.paceTo);
    return { text: p ? `${p.name} ${p.paceFrom}–${p.paceTo} W/kg` : 'Pace groups', fg: quiet };
  }
  if (e.me.canEnter === null) return { text: 'Check pen rules in Zwift', fg: '#8A6100' };
  const mine = e.pens.find((p) => p.id === e.me.myPenId);
  if (!mine) return { text: 'Open to all', fg: quiet };
  const basis = e.me.basis === 'zftp' ? 'zFTP' : e.me.basis === 'racing_score' ? 'Racing Score' : 'open';
  return { text: `Your pen: ${mine.name} (${basis})`, fg: '#3F6212' };
}

/** zwift.com's page for the event, where the athlete signs up. */
export const zwiftEventUrl = (id: number) => `https://www.zwift.com/events/view/${id}`;

/** The calendar session for an event: the athlete's pen (or the matched option), at its local start. */
export function calendarInputFor(e: EventItem, timeZone: string): CalendarEventInput {
  const pen = e.pens.find((p) => p.id === e.me.myPenId) ?? e.pens.find((p) => e.me.matchedPenIds.includes(p.id)) ?? e.pens[0];
  const start = pen?.start ?? e.start;
  const race = e.type === 'race' || e.type === 'tt' || e.type === 'ttt';
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(start));
  const where = [e.world, pen?.route ?? e.route].filter(Boolean).join(' · ');
  const minutes = pen?.durationMin ?? pen?.estMin;
  return {
    date: todayIn(timeZone, new Date(start)),
    kind: race ? 'race' : 'ride',
    type: race ? 'race' : 'endurance',
    title: e.name.slice(0, 120),
    platform: 'zwift',
    startTime: hhmm,
    tentative: false,
    ...(minutes ? { durationMin: Math.min(minutes, 24 * 60) } : {}),
    meta: [where, pen && e.penKind !== 'none' ? `Pen ${pen.name}` : ''].filter(Boolean).join(' · ').slice(0, 160),
    zwiftEventId: e.id,
    ...(pen ? { zwiftPenId: pen.id } : {}),
  };
}

/** Plain words for "Ask coach about these". */
export function filtersPrompt(f: EventFilters) {
  const chips = activeChips(f).map((c) => c.label);
  return `Looking at Zwift events${chips.length ? ` (${chips.join(', ')})` : ''}: which of these fit my plan this week? `;
}

/** How many filters differ from the defaults ("Filters · 3"). */
export function countActive(f: EventFilters) {
  return activeChips(f).length;
}

export type EventsSearch = EventFilters & { sort: EventSort };
export const DEFAULT_EVENTS_SEARCH: EventsSearch = { ...DEFAULT_EVENT_FILTERS, sort: 'start' };
const eventsSearchSchema = eventFiltersSchema.extend({ sort: eventQuerySchema.shape.sort });

/** The URL's filters; anything invalid falls back to its default instead of losing the rest. */
export function parseEventsSearch(raw: Record<string, unknown>): EventsSearch {
  const input = { ...raw };
  for (let i = 0; i < 4; i++) {
    const r = eventsSearchSchema.safeParse(input);
    if (r.success) return r.data;
    for (const issue of r.error.issues) delete input[String(issue.path[0])];
  }
  return DEFAULT_EVENTS_SEARCH;
}
