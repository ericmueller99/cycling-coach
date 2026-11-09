import { analyzeZwiftCourse, lapKmOf, terrainFor, zwiftRouteTrack, zwiftSegments } from '@cycling-coach/core';
import { listZwiftRoutes, type Collections, type StoredRoute } from '@cycling-coach/db';
import type { CalendarEvent, Course, CourseAnalysis, CourseRoute, CourseSegment, ZwiftRouteOption } from '@cycling-coach/shared';
import type { FeatureSource } from '../integrations';
import type { RouteInfo, ZwiftRouteData } from '../providers/zwift/route-data';

/** The parts of a session a route course needs. */
export type RouteLinkedEvent = Pick<CalendarEvent, 'id' | 'kind' | 'zwiftRouteId' | 'zwiftLaps'>;

const COURSE_CACHE = 100;
const ROUTES_MAX_AGE_MS = 60 * 60 * 1000;

const round = (n: number, places = 0) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * A Zwift race's course from its route and laps (DECISIONS #102). Derived when read, never stored, so
 * a change of laps or route shows at once. Only accounts with the Zwift feature get one.
 */
export class ZwiftRouteCourses {
  private readonly built = new Map<string, Omit<Course, 'eventId'>>();
  private table: { at: number; routes: Map<number, StoredRoute> } | null = null;

  constructor(
    private readonly c: Collections,
    private readonly data: ZwiftRouteData,
    private readonly features: FeatureSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async allowed(userId: string): Promise<boolean> {
    return (await this.features.forUser(userId)).zwiftAccount;
  }

  /** GameDictionary's routes (`zwift_routes`), re-read hourly: the newest names and any route zwift-data lacks. */
  private async gameRoutes(): Promise<Map<number, StoredRoute>> {
    const t = this.now().getTime();
    if (!this.table || t - this.table.at > ROUTES_MAX_AGE_MS) this.table = { at: t, routes: new Map((await listZwiftRoutes(this.c)).map((r) => [r.id, r])) };
    return this.table.routes;
  }

  /** The routes the race form offers: GameDictionary's and zwift-data's together, by name. Null without the feature. */
  async options(userId: string): Promise<ZwiftRouteOption[] | null> {
    if (!(await this.allowed(userId))) return null;
    const game = await this.gameRoutes();
    const out = new Map<number, ZwiftRouteOption>();
    for (const r of this.data.all()) {
      const g = game.get(r.id);
      out.set(r.id, {
        id: r.id,
        name: g?.name ?? r.name,
        world: g?.world ?? r.world,
        distanceKm: round(r.lapKm, 1),
        ascentM: round(r.ascentM),
        leadinKm: round(r.leadinKm, 1),
        leadinAscentM: round(r.leadinAscentM),
        hasProfile: r.hasStream,
      });
    }
    for (const g of game.values()) {
      if (out.has(g.id)) continue;
      out.set(g.id, {
        id: g.id,
        name: g.name,
        world: g.world,
        distanceKm: round(g.distanceM / 1000, 1),
        ascentM: round(g.ascentM),
        leadinKm: round(g.leadinM / 1000, 1),
        leadinAscentM: round(g.leadinAscentM),
        hasProfile: false,
      });
    }
    return [...out.values()].sort((a, b) => (a.world ?? '').localeCompare(b.world ?? '') || a.name.localeCompare(b.name));
  }

  /** A race's course from its route, or null: no route, not a race, no such route, or no Zwift feature. */
  async course(userId: string, event: RouteLinkedEvent): Promise<Course | null> {
    if (event.kind !== 'race' || event.zwiftRouteId === undefined) return null;
    if (!(await this.allowed(userId))) return null;
    const lapsUnknown = event.zwiftLaps === undefined;
    const laps = event.zwiftLaps ?? 1;
    const key = `${event.zwiftRouteId}:${laps}:${lapsUnknown}`;
    let built = this.built.get(key);
    if (!built) {
      const b = await this.build(event.zwiftRouteId, laps, lapsUnknown);
      if (!b) return null;
      built = b;
      this.built.set(key, built);
      if (this.built.size > COURSE_CACHE) this.built.delete(this.built.keys().next().value!);
    }
    return { eventId: event.id, ...built };
  }

  private async build(routeId: number, laps: number, lapsUnknown: boolean): Promise<Omit<Course, 'eventId'> | null> {
    const info = this.data.info(routeId);
    const game = (await this.gameRoutes()).get(routeId);
    if (!info && !game) return null;
    const name = game?.name ?? info!.name;
    const world = game?.world ?? info?.world;
    const leadinKm = info ? info.leadinKm : game!.leadinM / 1000;
    const stream = info?.hasStream ? await this.data.stream(routeId) : null;
    const lapKm = stream ? lapKmOf(stream) : (info?.lapKm ?? game!.distanceM / 1000);
    const segments: CourseSegment[] = info ? zwiftSegments(info.segments, { leadinKm, lapKm, laps }) : [];
    const route: CourseRoute = {
      id: routeId,
      name,
      ...(world ? { world } : {}),
      laps,
      lapsUnknown,
      lapKm: round(lapKm, 2),
      leadinKm: round(leadinKm, 2),
      hasProfile: !!stream,
      ...(info?.zwiftInsiderUrl ? { zwiftInsiderUrl: info.zwiftInsiderUrl } : {}),
      ...(info?.whatsOnZwiftUrl ? { whatsOnZwiftUrl: info.whatsOnZwiftUrl } : {}),
    };
    const track = stream ? zwiftRouteTrack(stream, { leadinKm, laps }) : [];
    const analysis = track.length ? analyzeZwiftCourse(track, segments) : totalsOnly(info, game, laps);
    return { name, source: 'zwift', route, segments, analysis };
  }
}

/** Without heights: the route's own distance and climbing, nothing measured. */
function totalsOnly(info: RouteInfo | null, game: StoredRoute | undefined, laps: number): CourseAnalysis {
  const lapKm = info?.lapKm ?? game!.distanceM / 1000;
  const leadKm = info ? info.leadinKm : game!.leadinM / 1000;
  const lapUp = info?.ascentM ?? game!.ascentM;
  const leadUp = info ? info.leadinAscentM : game!.leadinAscentM;
  const distanceKm = round(leadKm + laps * lapKm, 1);
  const ascentM = round(leadUp + laps * lapUp);
  return { distanceKm, ascentM, descentM: null, minM: null, maxM: null, terrain: terrainFor(distanceKm, ascentM), climbs: [], finishGainM: null, profile: [] };
}
