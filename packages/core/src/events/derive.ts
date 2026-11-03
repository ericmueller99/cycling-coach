import type { EventSeriesKey, PenKind, UnlockKind, ZwiftEvent, ZwiftEventPen, ZwiftEventType } from '@cycling-coach/shared';
import { penLength, terrainFor, worldName, type ZwiftRoute } from './routes';

/** One pen as the provider read it from Zwift, before anything is derived. */
export interface ZwiftPenSource {
  id: number;
  label: number;
  name?: string | undefined;
  start: string;
  routeId?: number | undefined;
  laps?: number | undefined;
  distanceM?: number | undefined;
  durationS?: number | undefined;
  paceFrom?: number | undefined;
  paceTo?: number | undefined;
  rangeLabel?: string | undefined;
  access?: string | undefined;
  rules: string[];
  tags: string[];
  signedUp: number;
}

/** One event as the provider read it from Zwift. */
export interface ZwiftEventSource {
  id: number;
  name: string;
  eventType: string;
  sport: string;
  start: string;
  mapId?: number | undefined;
  routeId?: number | undefined;
  laps?: number | undefined;
  distanceM?: number | undefined;
  durationS?: number | undefined;
  description?: string | undefined;
  imageUrl?: string | undefined;
  categoryEnforced: boolean;
  access?: string | undefined;
  rules: string[];
  tags: string[];
  seriesName?: string | undefined;
  signedUp: number;
  friends: number;
  pens: ZwiftPenSource[];
}

const TYPES: Record<string, ZwiftEventType> = {
  RACE: 'race',
  GROUP_RIDE: 'group_ride',
  EFONDO: 'group_ride',
  GROUP_WORKOUT: 'workout',
  TIME_TRIAL: 'tt',
  TEAM_TIME_TRIAL: 'ttt',
};

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
export const penLetter = (label: number) => LETTERS[label - 1] ?? String(label);

const DESCRIPTION_MAX = 600;

/**
 * - one pen → `none`;
 * - pens that differ in route/laps/distance but share one pace range and no category rules →
 *   `distance` (Long / Standard / Short, zFondo A 112 km / B 76 km …);
 * - races, TTs and anything with access rules → `category`;
 * - everything else → `pace`.
 */
export function penKindOf(src: Pick<ZwiftEventSource, 'eventType' | 'categoryEnforced' | 'access' | 'pens'>): PenKind {
  const pens = src.pens;
  if (pens.length <= 1) return 'none';
  const shapes = new Set(pens.map((p) => `${p.routeId}/${p.laps}/${p.distanceM ?? 0}/${p.durationS ?? 0}`));
  const paces = new Set(pens.map((p) => `${p.paceFrom ?? 0}-${p.paceTo ?? 0}`));
  const ruled = src.categoryEnforced || Boolean(src.access) || pens.some((p) => p.access);
  if (shapes.size > 1 && paces.size <= 1 && !ruled) return 'distance';
  if (ruled || ['RACE', 'TIME_TRIAL', 'TEAM_TIME_TRIAL'].includes(src.eventType)) return 'category';
  return 'pace';
}

/** "Long - Stage 5 - Tour of Watopia 2026" → "Long"; otherwise the pen letter. */
function optionName(pen: ZwiftPenSource): string {
  const head = pen.name?.split(' - ')[0]?.trim();
  return head && head.length <= 12 && /^(long|standard|short|medium|mini|full|half|epic|classic|extended)\b/i.test(head)
    ? head
    : penLetter(pen.label);
}

export function seriesOf(name: string, seriesName: string | undefined, tags: string[]): EventSeriesKey | undefined {
  const text = `${name} ${seriesName ?? ''} ${tags.join(' ')}`;
  if (/zwift racing league|\bzrl\b|\bwtrl zrl\b/i.test(text)) return 'zrl';
  if (/tour of watopia|\btow20\d\d/i.test(text)) return 'tour_of_watopia';
  if (/zfondo|gran ?fondo/i.test(text)) return 'zfondo';
  if (/pace ?partner|\bpacer\b/i.test(text)) return 'pacer';
  return undefined;
}

/**
 * What an event unlocks, from its `jerseyunlock` tag and its description ("unlock the … kit").
 * `head_gear=…` / `socks=…` tags are kit riders are put in for the event, not rewards. Not
 * complete — organisers describe rewards in their own words.
 */
export function unlocksOf(tags: string[], description: string | undefined): UnlockKind[] {
  const found = new Set<UnlockKind>();
  const keys = tags.map((t) => t.split('=')[0]!.toLowerCase());
  if (keys.includes('jerseyunlock')) found.add('kit');
  const text = description ?? '';
  const rewards = [...text.matchAll(/(?:unlock|earn|reward|win)[^.!\n]{0,80}/gi)].map((m) => m[0]).join(' ');
  if (/\b(kit|jersey|cap|helmet|socks|glasses|shoes)\b/i.test(rewards)) found.add('kit');
  if (/route badge/i.test(rewards)) found.add('route_badge');
  else if (/\bbadge\b/i.test(rewards)) found.add('badge');
  if (/\b(bike|frame|wheels?|wheelset)\b/i.test(rewards)) found.add('bike');
  return [...found];
}

const min = (xs: number[]) => (xs.length ? Math.min(...xs) : undefined);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : undefined);

/** Zwift's event → ours, or null for anything that isn't a cycling event we can show. */
export function deriveEvent(
  src: ZwiftEventSource,
  routeOf: (id: number | undefined) => ZwiftRoute | undefined,
  seenVia: ZwiftEvent['seenVia'],
): ZwiftEvent | null {
  const type = TYPES[src.eventType];
  if (src.sport !== 'CYCLING' || !type) return null;

  const kind = penKindOf(src);
  const sources = src.pens.length
    ? src.pens
    : [{ id: src.id, label: 1, start: src.start, rules: [], tags: [], signedUp: src.signedUp }];
  const pens: ZwiftEventPen[] = sources
    .map((p) => {
      const routeId = p.routeId ?? src.routeId;
      const route = routeOf(routeId);
      const laps = p.laps || src.laps || undefined;
      const durationS = p.durationS || src.durationS;
      const timed = Boolean(durationS && durationS > 0);
      const { km, ascentM } = timed ? {} : penLength({ distanceM: p.distanceM || src.distanceM, laps }, route);
      return {
        id: p.id,
        label: p.label,
        name: kind === 'distance' ? optionName(p) : penLetter(p.label),
        start: p.start,
        routeId,
        route: route?.name,
        laps,
        km,
        ascentM,
        terrain: km !== undefined && ascentM !== undefined ? terrainFor(km, ascentM) : undefined,
        durationMin: timed ? Math.round(durationS! / 60) : undefined,
        paceFrom: p.paceFrom || undefined,
        paceTo: p.paceTo || undefined,
        rangeLabel: p.rangeLabel,
        access: p.access,
        rules: p.rules,
        signedUp: p.signedUp,
      };
    })
    .sort((a, b) => a.label - b.label);

  const kms = pens.flatMap((p) => (p.km !== undefined ? [p.km] : []));
  const ascents = pens.flatMap((p) => (p.ascentM !== undefined ? [p.ascentM] : []));
  const first = pens[0]!;
  const description = src.description?.trim();
  const allRules = [...new Set([...src.rules, ...pens.flatMap((p) => p.rules)])];

  return {
    id: src.id,
    name: src.name.trim(),
    type,
    start: pens.reduce((s, p) => (p.start < s ? p.start : s), first.start),
    world: worldName(src.mapId, routeOf(first.routeId)),
    route: first.route,
    laps: first.laps,
    description: description ? (description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX - 1)}…` : description) : undefined,
    imageUrl: src.imageUrl,
    categoryEnforced: src.categoryEnforced,
    access: src.access,
    rules: allRules,
    tags: src.tags,
    series: seriesOf(src.name, src.seriesName, src.tags),
    seriesName: src.seriesName,
    signedUp: src.signedUp,
    friends: src.friends,
    penKind: kind,
    pens,
    kmMin: min(kms),
    kmMax: max(kms),
    ascentMin: min(ascents),
    ascentMax: max(ascents),
    unlocks: unlocksOf(src.tags, src.description),
    ranked: src.tags.includes('ranked'),
    womenOnly: src.rules.includes('LADIES_ONLY') || (pens.length > 0 && pens.every((p) => p.rules.includes('LADIES_ONLY'))),
    seenVia,
  };
}
