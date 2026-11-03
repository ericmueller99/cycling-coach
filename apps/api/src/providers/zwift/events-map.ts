import { worldFromMap, type ZwiftEventSource, type ZwiftPenSource, type ZwiftRoute } from '@cycling-coach/core';

/** Shapes per the live feeds (research pull, 2026-10-31); everything is optional, odd values dropped. */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
/** "2026-10-31T06:00:00.000+0000" → "2026-10-31T06:00:00.000Z". */
const iso = (v: unknown) => {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

/** Tags we never filter or show on: physics overrides, timestamps, organiser bookkeeping. */
const NOISE = /^(timestamp|bike_|front_wheel|rear_wheel|fwheel|rwheel|powerup_percent|after_party|event_timeofday|rain_override|created|createdby|dev_logs|arch_powerup|head_gear|socks|glasses|cycling_shoes)/i;

function mapPen(raw: unknown, fallbackStart: string): ZwiftPenSource | null {
  if (!isObj(raw)) return null;
  const id = num(raw['id']);
  const label = num(raw['label']);
  if (id === undefined || label === undefined) return null;
  return {
    id,
    label,
    name: str(raw['name']),
    start: iso(raw['eventSubgroupStart']) ?? fallbackStart,
    routeId: num(raw['routeId']),
    laps: num(raw['laps']),
    distanceM: num(raw['distanceInMeters']),
    durationS: num(raw['durationInSeconds']),
    paceFrom: num(raw['fromPaceValue']),
    paceTo: num(raw['toPaceValue']),
    rangeLabel: str(raw['rangeAccessLabel']),
    access: str(raw['accessExpression'])?.trim(),
    rules: strs(raw['rulesSet']),
    tags: strs(raw['tags']),
    signedUp: num(raw['totalSignedUpCount']) ?? 0,
  };
}

/** One event from either feed (they share a shape). Null for anything without an id and start. */
export function mapEvent(raw: unknown): ZwiftEventSource | null {
  if (!isObj(raw)) return null;
  const id = num(raw['id']);
  const name = str(raw['name']);
  const start = iso(raw['eventStart']);
  if (id === undefined || !name || !start) return null;
  const series = isObj(raw['eventSeries']) ? str(raw['eventSeries']['name']) : undefined;
  const pens = (Array.isArray(raw['eventSubgroups']) ? raw['eventSubgroups'] : []).flatMap((p) => mapPen(p, start) ?? []);
  const tags = strs(raw['tags']);
  return {
    id,
    name,
    eventType: str(raw['eventType']) ?? '',
    sport: str(raw['sport']) ?? '',
    start,
    mapId: num(raw['mapId']),
    routeId: num(raw['routeId']),
    laps: num(raw['laps']),
    distanceM: num(raw['distanceInMeters']),
    durationS: num(raw['durationInSeconds']),
    description: str(raw['description']),
    imageUrl: str(raw['imageUrl']),
    categoryEnforced: raw['categoryEnforcement'] === true,
    access: str(raw['accessExpression'])?.trim(),
    rules: strs(raw['rulesSet']),
    tags: tags.filter((t) => !NOISE.test(t)).map((t) => t.split('=')[0]!),
    seriesName: series,
    signedUp: num(raw['totalSignedUpCount']) ?? 0,
    friends: num(raw['followeeSignedUpCount']) ?? 0,
    pens,
  };
}

/** Pen ids the logged-in rider is signed up to (`signedUp` on each subgroup). */
export function signedUpPens(raw: unknown): number[] {
  if (!isObj(raw) || !Array.isArray(raw['eventSubgroups'])) return [];
  return raw['eventSubgroups'].flatMap((p) => (isObj(p) && p['signedUp'] === true && typeof p['id'] === 'number' ? [p['id']] : []));
}

const ATTR = /(\w+)="([^"]*)"/g;
const decode = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Cycling routes from GameDictionary.xml (`<ROUTE … signature="…"/>`). No XML parser needed. */
export function mapRoutes(xml: string): ZwiftRoute[] {
  const routes: ZwiftRoute[] = [];
  for (const [tag] of xml.matchAll(/<ROUTE\s[^>]*>/g)) {
    const a: Record<string, string> = {};
    for (const [, k, v] of tag.matchAll(ATTR)) a[k!] = decode(v!);
    const id = Number(a['signature']);
    const distanceM = Number(a['distanceInMeters']);
    const sports = Number(a['sports'] ?? 0);
    // `sports` is a bit mask: 1 = cycling, 2 = running. Entries with no `map` are climb-portal
    // segments in other units, not routes events use.
    if (!Number.isFinite(id) || !a['name'] || !a['map'] || !(distanceM > 0) || (sports & 1) === 0) continue;
    routes.push({
      id,
      name: a['name'],
      world: worldFromMap(a['map']),
      distanceM,
      ascentM: Number(a['ascentInMeters']) || 0,
      leadinM: Number(a['leadinDistanceInMeters']) || 0,
      leadinAscentM: Number(a['leadinAscentInMeters']) || 0,
    });
  }
  return routes;
}
