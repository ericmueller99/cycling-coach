import type { Terrain } from '@cycling-coach/shared';

/** A route from Zwift's GameDictionary.xml; `id` is its `signature`, the events' `routeId`. */
export interface ZwiftRoute {
  id: number;
  name: string;
  world?: string | undefined;
  distanceM: number;
  ascentM: number;
  leadinM: number;
  leadinAscentM: number;
}

/** Event `mapId` → world. Checked against the routes each event's `routeId` names. */
const WORLDS: Record<number, string> = {
  1: 'Watopia',
  2: 'Richmond',
  3: 'London',
  4: 'New York',
  5: 'Innsbruck',
  6: 'Bologna',
  7: 'Yorkshire',
  8: 'Crit City',
  9: 'Makuri Islands',
  10: 'France',
  11: 'Paris',
  12: 'Gravel Mountain',
  13: 'Scotland',
};

/** GameDictionary `map` attribute → world. */
const MAPS: Record<string, string> = {
  WATOPIA: 'Watopia',
  RICHMOND: 'Richmond',
  LONDON: 'London',
  NEWYORK: 'New York',
  INNSBRUCK: 'Innsbruck',
  BOLOGNATT: 'Bologna',
  YORKSHIRE: 'Yorkshire',
  CRITCITY: 'Crit City',
  MAKURIISLANDS: 'Makuri Islands',
  FRANCE: 'France',
  PARIS: 'Paris',
  GRAVEL: 'Gravel Mountain',
  SCOTLAND: 'Scotland',
};

export function worldFromMap(map: string | undefined): string | undefined {
  return map ? MAPS[map.toUpperCase()] : undefined;
}

/** The event's world, falling back to the route's when the event has no `mapId`. */
export function worldName(mapId: number | undefined, route: ZwiftRoute | undefined): string | undefined {
  return (mapId !== undefined ? WORLDS[mapId] : undefined) ?? route?.world;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A pen's distance and climbing: its own distance when set (climbing scaled from the route), else
 * lead-in + laps × the route. Unknown route and no distance → nothing; a time-based pen has no km.
 */
export function penLength(
  pen: { distanceM?: number | undefined; laps?: number | undefined },
  route: ZwiftRoute | undefined,
): { km?: number; ascentM?: number } {
  if (pen.distanceM && pen.distanceM > 0) {
    const km = round1(pen.distanceM / 1000);
    if (!route || route.distanceM <= 0) return { km };
    const perM = route.ascentM / route.distanceM;
    return { km, ascentM: Math.round(route.leadinAscentM + Math.max(0, pen.distanceM - route.leadinM) * perM) };
  }
  if (!route || route.distanceM <= 0) return {};
  const laps = Math.max(1, pen.laps ?? 1);
  return {
    km: round1((route.leadinM + laps * route.distanceM) / 1000),
    ascentM: Math.round(route.leadinAscentM + laps * route.ascentM),
  };
}

export function terrainFor(km: number, ascentM: number): Terrain {
  const perKm = km > 0 ? ascentM / km : 0;
  if (perKm < 5) return 'flat';
  if (perKm < 10) return 'rolling';
  if (perKm < 20) return 'hilly';
  return 'mountain';
}

/** Group-ride speed on the flat at a W/kg, km/h (drafting in a bunch). */
const FLAT_SPEED: [wkg: number, kmh: number][] = [
  [1, 24],
  [1.5, 27],
  [2, 30],
  [2.5, 33],
  [3, 36],
  [3.5, 38.5],
  [4, 41],
  [4.5, 43],
  [5, 45],
];

function flatSpeed(wkg: number): number {
  const first = FLAT_SPEED[0]!;
  const last = FLAT_SPEED[FLAT_SPEED.length - 1]!;
  if (wkg <= first[0]) return first[1];
  if (wkg >= last[0]) return last[1];
  const i = FLAT_SPEED.findIndex(([w]) => w >= wkg);
  const [w0, s0] = FLAT_SPEED[i - 1]!;
  const [w1, s1] = FLAT_SPEED[i]!;
  return s0 + ((wkg - w0) / (w1 - w0)) * (s1 - s0);
}

/**
 * Rough ride time: distance at bunch speed plus most of the climbing at a VAM of 330 m/h per W/kg.
 * Within about 10% of real Zwift times for flat to Alpe-type routes — it's labelled "~" in the UI.
 */
export function estimateMinutes(km: number, ascentM: number, wkg: number): number {
  const w = Math.max(0.5, wkg);
  return Math.round((km / flatSpeed(w) + (0.7 * ascentM) / (330 * w)) * 60);
}
