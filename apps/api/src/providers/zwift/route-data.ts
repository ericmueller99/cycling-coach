import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RouteSegmentOnLap, RouteStream } from '@cycling-coach/core';
import { climbCategories, type ClimbCategory } from '@cycling-coach/shared';
import { routes as zdRoutes, segments as zdSegments, type Route } from 'zwift-data';

/**
 * Zwift route profiles from the `zwift-data` package (DECISIONS #102), the only file that reads it.
 * Its route `id` is Zwift's own (GameDictionary `signature`, an event pen's `routeId`). The route list
 * and segment positions come from Zwift's public API and manual work. The one-lap heights come from
 * Strava segment streams, so this is for accounts with the Zwift feature only, and none of it reaches
 * the coach. Nothing is fetched: it's all in the package.
 */

export interface RouteInfo {
  id: number;
  name: string;
  world: string;
  lapKm: number;
  ascentM: number;
  leadinKm: number;
  leadinAscentM: number;
  /** Named segments on one lap, in order. */
  segments: RouteSegmentOnLap[];
  /** There's a height stream for it. */
  hasStream: boolean;
  zwiftInsiderUrl?: string | undefined;
  whatsOnZwiftUrl?: string | undefined;
}

/** zwift-data's world slugs, as the app names worlds (`core` WORLDS). */
const WORLD_NAMES: Record<string, string> = {
  watopia: 'Watopia',
  richmond: 'Richmond',
  london: 'London',
  'new-york': 'New York',
  innsbruck: 'Innsbruck',
  bologna: 'Bologna',
  yorkshire: 'Yorkshire',
  'crit-city': 'Crit City',
  'makuri-islands': 'Makuri Islands',
  france: 'France',
  paris: 'Paris',
  scotland: 'Scotland',
};

const SLUG = /^[a-z0-9-]+$/;
const STREAM_CACHE = 50;

const isCategory = (v: unknown): v is ClimbCategory => typeof v === 'string' && (climbCategories as readonly string[]).includes(v);
const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

export class ZwiftRouteData {
  private readonly byId = new Map<number, Route>();
  private readonly streams = new Map<number, RouteStream | null>();
  private readonly streamSlugs: Set<string>;
  private readonly streamDir: string;

  constructor() {
    for (const r of zdRoutes) if (r.id !== undefined && r.sports.includes('cycling')) this.byId.set(r.id, r);
    const pkg = createRequire(import.meta.url).resolve('zwift-data/package.json');
    this.streamDir = join(dirname(pkg), 'lib', 'streams', 'routes');
    this.streamSlugs = new Set(this.listStreams());
  }

  /** The route slugs with a stream: one file each, `<slug>.js`, so they're loaded one at a time, never all 31 MB. */
  private listStreams(): string[] {
    try {
      return readdirSync(this.streamDir)
        .filter((f) => f.endsWith('.js'))
        .map((f) => f.slice(0, -3));
    } catch {
      return [];
    }
  }

  /** Every cycling route zwift-data knows, with its named segments. */
  all(): RouteInfo[] {
    return [...this.byId.keys()].map((id) => this.info(id)!);
  }

  info(id: number): RouteInfo | null {
    const r = this.byId.get(id);
    if (!r) return null;
    return {
      id,
      name: r.name,
      world: WORLD_NAMES[r.world] ?? r.world,
      lapKm: r.distance,
      ascentM: r.elevation,
      leadinKm: r.leadInDistance ?? 0,
      leadinAscentM: r.leadInElevation ?? 0,
      segments: r.segmentsOnRoute.flatMap((s) => {
        const seg = SEGMENTS.get(s.segment);
        if (!seg || !(s.to > s.from)) return [];
        return [{ fromKm: s.from, toKm: s.to, name: seg.name, kind: seg.type, ...(isCategory(seg.climbType) ? { category: seg.climbType } : {}) }];
      }),
      hasStream: this.streamSlugs.has(r.slug),
      ...(r.zwiftInsiderUrl ? { zwiftInsiderUrl: r.zwiftInsiderUrl } : {}),
      ...(r.whatsOnZwiftUrl ? { whatsOnZwiftUrl: r.whatsOnZwiftUrl } : {}),
    };
  }

  /** One lap's heights by distance, or null when there's none. Loads one file and keeps the last few. */
  async stream(id: number): Promise<RouteStream | null> {
    if (this.streams.has(id)) {
      const hit = this.streams.get(id)!;
      // Most recently used goes last.
      this.streams.delete(id);
      this.streams.set(id, hit);
      return hit;
    }
    const slug = this.byId.get(id)?.slug;
    let out: RouteStream | null = null;
    if (slug && SLUG.test(slug) && this.streamSlugs.has(slug)) {
      const mod = (await import(pathToFileURL(join(this.streamDir, `${slug}.js`)).href)) as Record<string, unknown>;
      const distanceM = mod['distance'];
      const altitudeM = mod['altitude'];
      if (isNumbers(distanceM) && isNumbers(altitudeM) && distanceM.length === altitudeM.length && distanceM.length >= 2) out = { distanceM, altitudeM };
    }
    this.streams.set(id, out);
    if (this.streams.size > STREAM_CACHE) this.streams.delete(this.streams.keys().next().value!);
    return out;
  }
}

const SEGMENTS = new Map(zdSegments.map((s) => [s.slug, s]));
