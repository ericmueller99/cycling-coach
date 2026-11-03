import type {
  EventFilters,
  EventForMe,
  EventItem,
  EventQuery,
  EventQueryResult,
  TimeOfDay,
  ZwiftEvent,
  ZwiftEventPen,
} from '@cycling-coach/shared';
import { addDays, todayIn } from '../dates';
import { zoneWatts } from '../zones';
import { zwiftCategory } from '../zwift';
import { accessBasis, categoryNumber, evaluateAccess, type AccessContext } from './access';
import { penLetter } from './derive';
import { estimateMinutes } from './routes';

/** What the Events page knows about the athlete. Everything but FTP and weight may be missing. */
export interface EventAthlete {
  ftp: number;
  weightKg: number;
  /** The weight set in Zwift — what Zwift's W/kg rules use. */
  zwiftWeightKg?: number | undefined;
  zftp?: number | undefined;
  zmap?: number | undefined;
  /** Zwift's own category, when synced. */
  category?: string | undefined;
  racingScore?: number | undefined;
  zwiftId?: number | undefined;
}

/** The athlete's own links to events: sign-ups (extended feed) and calendar sessions. */
export interface EventUserState {
  signedUpPenIds: Map<number, number[]>;
  calendarEventIds: Map<number, string>;
}

export interface QueryContext {
  now: Date;
  timeZone: string;
}

const HOURS: Record<TimeOfDay, [number, number]> = {
  morning: [5, 11],
  midday: [11, 14],
  afternoon: [14, 18],
  evening: [18, 24],
};

/** "HH:mm" and the local date of an instant in the athlete's zone. */
function localParts(iso: string, timeZone: string): { date: string; hhmm: string; hour: number } {
  const d = new Date(iso);
  const date = todayIn(timeZone, d);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { date, hhmm, hour: Number(hhmm.slice(0, 2)) };
}

function accessContext(a: EventAthlete): AccessContext {
  const weightKg = a.zwiftWeightKg ?? a.weightKg;
  const computed = a.zftp || a.zmap ? zwiftCategory({ zftp: a.zftp, zmap: a.zmap, weightKg })?.category : undefined;
  return {
    zftp: a.zftp,
    zmap: a.zmap,
    weightKg,
    category: categoryNumber(a.category ?? computed),
    racingScore: a.racingScore,
    zwiftId: a.zwiftId,
  };
}

const RANGE = /^(\d+)\s*-\s*(\d+)$/;

/** Who may enter which pen, and which pen is the athlete's. */
export function eligibility(
  event: ZwiftEvent,
  athlete: EventAthlete | null,
): Pick<EventForMe, 'canEnter' | 'myPenId' | 'basis' | 'enterablePenIds'> {
  const all = event.pens.map((p) => p.id);
  if (event.womenOnly) return { canEnter: false, enterablePenIds: [] };
  if (event.penKind === 'distance' || event.penKind === 'none' || (!event.categoryEnforced && !event.access && !event.pens.some((p) => p.access))) {
    return { canEnter: true, basis: 'open', enterablePenIds: all };
  }
  if (!athlete) return { canEnter: null, enterablePenIds: [] };

  const ctx = accessContext(athlete);
  let basis: EventForMe['basis'];
  /** Zwift's own enforcement: your category or a harder one (A+ rides A). */
  const byCategory = (label: number) => {
    basis ??= 'zftp';
    if (ctx.category === undefined) return null;
    return ctx.category === 0 ? label === 1 : ctx.category >= label;
  };
  const verdicts = event.pens.map((pen): boolean | null => {
    if (pen.rules.includes('LADIES_ONLY')) return false;
    const expr = pen.access ?? event.access;
    if (expr) {
      const own = accessBasis(expr);
      basis ??= own;
      const v = evaluateAccess(expr, ctx, pen.label);
      // An expression that only bans riders by id still leaves Zwift's category rule in force.
      if (!own && event.categoryEnforced && v !== false) {
        const c = byCategory(pen.label);
        return c === false ? false : v === null || c === null ? null : true;
      }
      return v;
    }
    const range = pen.rangeLabel ? RANGE.exec(pen.rangeLabel) : null;
    if (range && Number(range[2]) <= 1000) {
      basis = 'racing_score';
      // Racing Score pens: your own range or a harder one.
      return ctx.racingScore === undefined ? null : ctx.racingScore <= Number(range[2]);
    }
    if (event.categoryEnforced) return byCategory(pen.label);
    return true;
  });

  const enterable = event.pens.filter((_, i) => verdicts[i] === true);
  // Their pen: the easiest one they're allowed into.
  const mine = enterable.reduce<ZwiftEventPen | undefined>((best, p) => (!best || p.label > best.label ? p : best), undefined);
  const canEnter = enterable.length ? true : verdicts.some((v) => v === null) ? null : false;
  return {
    canEnter,
    myPenId: mine?.id,
    basis: basis ?? 'open',
    enterablePenIds: enterable.map((p) => p.id),
  };
}

/** The athlete's Z2 as W/kg (Zwift weight, like Zwift's own numbers). */
export function z2Wkg(athlete: EventAthlete): [number, number] {
  const kg = athlete.zwiftWeightKg ?? athlete.weightKg;
  const [lo, hi] = zoneWatts('Z2', athlete.ftp);
  return [lo / kg, hi / kg];
}

const fitsRange = (pen: ZwiftEventPen, [lo, hi]: [number, number]) =>
  pen.paceFrom !== undefined && pen.paceTo !== undefined && pen.paceTo > 0 && pen.paceFrom >= lo - 0.05 && pen.paceTo <= hi + 0.05;

/** W/kg a pen is likely ridden at, for the time estimate. */
function paceFor(event: ZwiftEvent, pen: ZwiftEventPen, athlete: EventAthlete | null): number {
  if (pen.paceFrom && pen.paceTo && pen.paceTo <= 6) return (pen.paceFrom + pen.paceTo) / 2;
  if (!athlete) return event.type === 'race' ? 3.5 : 2.5;
  const kg = athlete.zwiftWeightKg ?? athlete.weightKg;
  const ftp = athlete.zftp ?? athlete.ftp;
  return event.type === 'race' || event.type === 'tt' || event.type === 'ttt' ? (ftp * 0.9) / kg : (athlete.ftp * 0.65) / kg;
}

/** Each pen's ride time: its own duration, else an estimate from distance and climbing. */
export function withEstimates(event: ZwiftEvent, athlete: EventAthlete | null): ZwiftEventPen[] {
  return event.pens.map((p) => {
    const estMin = p.durationMin ?? (p.km !== undefined ? estimateMinutes(p.km, p.ascentM ?? 0, paceFor(event, p, athlete)) : undefined);
    return estMin === undefined ? p : { ...p, estMin };
  });
}

type FacetKey = 'types' | 'worlds';

interface Candidate {
  event: ZwiftEvent;
  pens: ZwiftEventPen[];
  me: EventForMe;
  local: { date: string; hhmm: string; hour: number };
}

function lengthOf(pen: ZwiftEventPen, unit: EventFilters['lengthUnit']): number | undefined {
  return unit === 'km' ? pen.km : pen.estMin;
}

/** Pens that satisfy the length and terrain filters (all pens when neither is set). */
function fittingPens(c: Candidate, f: EventFilters): ZwiftEventPen[] {
  const lengthSet = f.lengthMin !== undefined || f.lengthMax !== undefined;
  return c.pens.filter((p) => {
    if (lengthSet) {
      const v = lengthOf(p, f.lengthUnit);
      if (v === undefined) return false;
      if (f.lengthMin !== undefined && v < f.lengthMin) return false;
      if (f.lengthMax !== undefined && v >= f.lengthMax) return false;
    }
    if (f.terrain.length && (!p.terrain || !f.terrain.includes(p.terrain))) return false;
    return true;
  });
}

function matches(c: Candidate, f: EventFilters, today: string, nowMs: number, except?: FacetKey): boolean {
  const e = c.event;
  const rules = e.rules;
  if (f.upcoming && Date.parse(e.start) <= nowMs) return false;
  if (f.day === 'today' && c.local.date !== today) return false;
  if (f.day === 'tomorrow' && c.local.date !== addDays(today, 1)) return false;
  if (f.timesOfDay.length && !f.timesOfDay.some((t) => c.local.hour >= HOURS[t][0] && c.local.hour < HOURS[t][1])) return false;
  if (f.from && c.local.hhmm < f.from) return false;
  if (f.to && c.local.hhmm > f.to) return false;
  if (except !== 'types' && f.types.length && !f.types.includes(e.type)) return false;
  if (except !== 'worlds' && f.worlds.length && (!e.world || !f.worlds.includes(e.world))) return false;
  if (f.route && !c.pens.some((p) => p.route?.toLowerCase().includes(f.route!.toLowerCase()))) return false;
  if (e.signedUp < f.minSignedUp) return false;
  if (f.friends && e.friends <= 0) return false;
  if (f.canEnter && c.me.canEnter === false) return false;
  if (f.fitsZ2 && !c.me.fitsZ2) return false;
  if (f.hasUnlock && !e.unlocks.length) return false;
  if (f.unlocks.length && !f.unlocks.some((u) => e.unlocks.includes(u))) return false;
  if (f.penKinds.length && !f.penKinds.includes(e.penKind)) return false;
  if (f.pens.length && !c.pens.some((p) => f.pens.includes(penLetter(p.label) as never))) return false;
  if (f.penBasis !== 'any' && c.me.basis !== f.penBasis) return false;
  if (f.enforcedOnly && !e.categoryEnforced) return false;
  if (f.rankedOnly && !e.ranked) return false;
  if (f.powerups === 'yes' && rules.includes('NO_POWERUPS')) return false;
  if (f.powerups === 'no' && !rules.includes('NO_POWERUPS')) return false;
  if (f.lateJoin && !rules.includes('ALLOWS_LATE_JOIN')) return false;
  if (f.noDrafting && !rules.includes('NO_DRAFTING')) return false;
  if (f.ttBikes && rules.includes('NO_TT_BIKES')) return false;
  if (f.hrmRequired && !rules.includes('ENFORCE_HRM')) return false;
  if (f.hideWomenOnly && e.womenOnly) return false;
  if (f.series.length && (!e.series || !f.series.includes(e.series))) return false;
  if (f.signedUpOnly && !c.me.signedUpPenIds.length) return false;
  if (f.onCalendar && !c.me.calendarEventId) return false;
  if ((f.lengthMin !== undefined || f.lengthMax !== undefined || f.terrain.length) && !fittingPens(c, f).length) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [e.name, e.world, e.route, e.seriesName, e.description, ...c.pens.map((p) => p.route)].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const longest = (c: Candidate) => Math.max(0, ...c.pens.map((p) => p.km ?? 0));
const climbiest = (c: Candidate) => Math.max(0, ...c.pens.map((p) => p.ascentM ?? 0));

const SORTS: Record<EventQuery['sort'], (a: Candidate, b: Candidate) => number> = {
  start: (a, b) => a.event.start.localeCompare(b.event.start) || b.event.signedUp - a.event.signedUp,
  pop: (a, b) => b.event.signedUp - a.event.signedUp || a.event.start.localeCompare(b.event.start),
  km: (a, b) => longest(b) - longest(a) || a.event.start.localeCompare(b.event.start),
  elev: (a, b) => climbiest(b) - climbiest(a) || a.event.start.localeCompare(b.event.start),
};

/**
 * The Events page, `find_events` and saved searches all go through here: filter, facet counts
 * (each facet ignores its own filter, so the type list shows what ticking a box would add), sort
 * and page. Distance-option events match a length or terrain filter if ANY option fits; those
 * options come back in `matchedPenIds` to be highlighted.
 */
export function queryEvents(
  events: ZwiftEvent[],
  query: EventQuery,
  athlete: EventAthlete | null,
  user: EventUserState,
  ctx: QueryContext,
): EventQueryResult {
  const f = query.filters;
  const today = todayIn(ctx.timeZone, ctx.now);
  const nowMs = ctx.now.getTime();
  const z2 = athlete ? z2Wkg(athlete) : null;

  const candidates: Candidate[] = events
    // Started more than an hour ago (late join at most) → gone from the list, even before the TTL.
    .filter((e) => new Date(e.start).getTime() > nowMs - 60 * 60 * 1000)
    .map((event) => {
      const pens = withEstimates(event, athlete);
      const elig = eligibility(event, athlete);
      const c: Candidate = {
        event,
        pens,
        local: localParts(event.start, ctx.timeZone),
        me: {
          ...elig,
          matchedPenIds: [],
          fitsZ2: Boolean(z2 && event.type !== 'race' && pens.some((p) => fitsRange(p, z2))),
          signedUpPenIds: user.signedUpPenIds.get(event.id) ?? [],
          calendarEventId: user.calendarEventIds.get(event.id),
        },
      };
      if (event.penKind === 'distance' && (f.lengthMin !== undefined || f.lengthMax !== undefined || f.terrain.length)) {
        c.me.matchedPenIds = fittingPens(c, f).map((p) => p.id);
      }
      return c;
    });

  const types: EventQueryResult['facets']['types'] = {};
  const worlds: Record<string, number> = {};
  const hits: Candidate[] = [];
  for (const c of candidates) {
    if (matches(c, f, today, nowMs, 'types')) types[c.event.type] = (types[c.event.type] ?? 0) + 1;
    if (c.event.world && matches(c, f, today, nowMs, 'worlds')) worlds[c.event.world] = (worlds[c.event.world] ?? 0) + 1;
    if (matches(c, f, today, nowMs)) hits.push(c);
  }
  hits.sort(SORTS[query.sort]);

  return {
    items: hits.slice(query.offset, query.offset + query.limit).map((c): EventItem => ({ ...c.event, pens: c.pens, me: c.me })),
    total: hits.length,
    all: candidates.length,
    facets: { types, worlds },
  };
}
