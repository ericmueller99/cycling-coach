import type { Climb, ClimbCategory, CourseAnalysis, CourseSegment, ZwiftRouteOption } from '@cycling-coach/shared';

/**
 * Zwift race routes in the panel (DECISIONS #102): the same KOM comes round every lap, so the list
 * shows each climb or sprint once, with how often and where it first comes.
 */

/** A climb as listed: the first time it's ridden, and every km it starts at. */
export interface ClimbGroup {
  /** 1-based, in the order first ridden; the profile's markers use it. */
  label: number;
  name?: string | undefined;
  category?: ClimbCategory | undefined;
  first: Climb;
  startsKm: number[];
  /** It holds the course's longest climb. */
  longest: boolean;
}

export function groupClimbs(analysis: Pick<CourseAnalysis, 'climbs'>): { groups: ClimbGroup[]; labelOf: (n: number) => string } {
  const byKey = new Map<string, ClimbGroup>();
  const labelByN = new Map<number, number>();
  for (const c of analysis.climbs) {
    const key = c.name ?? `#${c.n}`;
    let g = byKey.get(key);
    if (!g) {
      g = { label: byKey.size + 1, ...(c.name ? { name: c.name } : {}), ...(c.category ? { category: c.category } : {}), first: c, startsKm: [], longest: false };
      byKey.set(key, g);
    }
    g.startsKm.push(c.startKm);
    if (c.longest) g.longest = true;
    labelByN.set(c.n, g.label);
  }
  return { groups: [...byKey.values()], labelOf: (n) => String(labelByN.get(n) ?? n) };
}

/** A sprint or other named segment as listed. */
export interface SegmentGroup {
  name: string;
  kind: CourseSegment['kind'];
  lengthKm: number;
  startsKm: number[];
}

/** The route's sprints and other timed segments, each once. Climbs are listed from the analysis instead. */
export function groupSegments(segments: readonly CourseSegment[]): SegmentGroup[] {
  const byName = new Map<string, SegmentGroup>();
  for (const s of segments) {
    if (s.kind === 'climb') continue;
    let g = byName.get(s.name);
    if (!g) {
      g = { name: s.name, kind: s.kind, lengthKm: Math.round((s.endKm - s.startKm) * 10) / 10, startsKm: [] };
      byName.set(s.name, g);
    }
    g.startsKm.push(s.startKm);
  }
  return [...byName.values()];
}

/** "km 1.2", or "×6 · first at km 1.2". */
export function wherePhrase(startsKm: readonly number[]): string {
  const first = `km ${startsKm[0]!.toFixed(1)}`;
  return startsKm.length > 1 ? `×${startsKm.length} · first at ${first}` : first;
}

/** A route with laps: lead-in once, then every lap. No laps counts as one. */
export function routeTotals(r: Pick<ZwiftRouteOption, 'distanceKm' | 'ascentM' | 'leadinKm' | 'leadinAscentM'>, laps: number | undefined) {
  const n = laps && laps > 0 ? laps : 1;
  return { km: Math.round((r.leadinKm + n * r.distanceKm) * 10) / 10, ascentM: Math.round(r.leadinAscentM + n * r.ascentM) };
}

/** The laps field: empty or nonsense means none; otherwise 1 to 50. */
export function parseLaps(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const n = Math.round(Number(t));
  return Number.isFinite(n) && n >= 1 ? Math.min(50, n) : undefined;
}

/** Routes matching a search by name or world, best first: name starts with it, then contains it. */
export function searchRoutes<T extends Pick<ZwiftRouteOption, 'name' | 'world'>>(routes: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...routes];
  const starts: T[] = [];
  const contains: T[] = [];
  for (const r of routes) {
    const name = r.name.toLowerCase();
    if (name.startsWith(q)) starts.push(r);
    else if (name.includes(q) || (r.world ?? '').toLowerCase().includes(q)) contains.push(r);
  }
  return [...starts, ...contains];
}
