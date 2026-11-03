import type { SessionType } from '@cycling-coach/shared';
import { CYCLING_SPORT } from './rides';

export interface MatchableEvent {
  id: string;
  date: string;
  type: SessionType;
  status: 'planned' | 'done' | 'skipped' | 'missed';
  durationMin?: number | undefined;
  activityId?: string | undefined;
  /** The intervals.icu event this session is mirrored to, for intervals.icu's own pairing. */
  intervalsEventId?: number | undefined;
  /** Rides the user unlinked from this session — never paired with it again. */
  ignoredActivityIds?: readonly string[] | undefined;
  /** Rides the user grouped into this session — taken, so never matched to another one. */
  extraActivityIds?: readonly string[] | undefined;
}

export interface MatchableActivity {
  id: string;
  /** Local start, `YYYY-MM-DDTHH:mm:ss`. */
  startLocal: string;
  name: string;
  sportType: string;
  movingSec: number;
  /** intervals.icu paired this ride with one of its planned events. */
  pairedEventId?: number | undefined;
}

const RACE = /\b(race|racing|ladder|zrl|crit|criterium|time trial|tt)\b/i;
const STRUCTURED = /\b(workout|interval|intervals|vo2|threshold|sweet ?spot|over-?unders?|\d+x\d+)\b/i;

function score(e: MatchableEvent, a: MatchableActivity): number {
  const isRace = RACE.test(a.name);
  let s = 0;
  switch (e.type) {
    case 'race':
      s += isRace ? 3 : -1;
      break;
    case 'intervals':
    case 'openers':
      s += STRUCTURED.test(a.name) ? 2 : 0;
      s -= isRace ? 2 : 0;
      break;
    case 'endurance':
    case 'recovery':
      s -= isRace ? 2 : 0;
      break;
  }
  if (e.durationMin) {
    const ratio = Math.abs(a.movingSec / 60 - e.durationMin) / e.durationMin;
    s += 1 - Math.min(1, ratio);
  }
  // A 10-minute spin before a race is a warm-up, not the session.
  if (a.movingSec < 15 * 60) s -= 1;
  return s;
}

/**
 * Pair completed rides with planned sessions on the same local day.
 *
 * intervals.icu's own pairing (`pairedEventId`) wins outright. Everything else is matched greedily
 * by score. `planned` and `missed` sessions are open — a late upload un-misses one — and an
 * activity is used at most once, and never with a session it was unlinked from. A pair needs a non-negative score: a race on a recovery day stays
 * unmatched rather than silently ticking the recovery session off.
 */
export function matchActivities(
  events: readonly MatchableEvent[],
  activities: readonly MatchableActivity[],
): { eventId: string; activityId: string }[] {
  const taken = new Set(events.flatMap((e) => [e.activityId, ...(e.extraActivityIds ?? [])]).filter(Boolean));
  const open = events.filter((e) => (e.status === 'planned' || e.status === 'missed') && !e.activityId);
  const rides = activities.filter((a) => CYCLING_SPORT.test(a.sportType) && !taken.has(a.id));

  const out: { eventId: string; activityId: string }[] = [];
  const usedEvents = new Set<string>();
  const usedActivities = new Set<string>();

  for (const a of rides) {
    if (a.pairedEventId === undefined) continue;
    const e = open.find((x) => x.intervalsEventId === a.pairedEventId && !x.ignoredActivityIds?.includes(a.id));
    if (!e || usedEvents.has(e.id)) continue;
    usedEvents.add(e.id);
    usedActivities.add(a.id);
    out.push({ eventId: e.id, activityId: a.id });
  }

  const pairs: { eventId: string; activityId: string; score: number }[] = [];
  for (const e of open) {
    if (usedEvents.has(e.id)) continue;
    for (const a of rides) {
      if (usedActivities.has(a.id) || a.startLocal.slice(0, 10) !== e.date || e.ignoredActivityIds?.includes(a.id)) continue;
      const s = score(e, a);
      if (s >= 0) pairs.push({ eventId: e.id, activityId: a.id, score: s });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  for (const p of pairs) {
    if (usedEvents.has(p.eventId) || usedActivities.has(p.activityId)) continue;
    usedEvents.add(p.eventId);
    usedActivities.add(p.activityId);
    out.push({ eventId: p.eventId, activityId: p.activityId });
  }
  return out;
}

/** Planned sessions whose day is over without a ride: they become `missed`. */
export function missedEventIds(events: readonly MatchableEvent[], today: string): string[] {
  return events.filter((e) => e.status === 'planned' && !e.activityId && e.date < today).map((e) => e.id);
}
