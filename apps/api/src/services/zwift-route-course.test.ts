import { collections, ensureIndexes, getEvent, saveZwiftRoutes, type Collections } from '@cycling-coach/db';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZwiftRouteData } from '../providers/zwift/route-data';
import { CalendarService } from './calendar';
import { ZwiftRouteCourses } from './zwift-route-course';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;
let cal: CalendarService;
let routes: ZwiftRouteCourses;

const FLAGGED = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const now = new Date('2026-11-07T12:00:00Z');

/** Real route ids (Zwift's own, as the events' `routeId`), from the zwift-data package. */
const VOLCANO_CIRCUIT = 686828068;
const BIG_LOOP = 2947111049;
const THREE_LITTLE_SISTERS = 2627606248;
/** A made-up route only GameDictionary knows. */
const NEW_ROUTE = 123456789;

const race = (extra: object = {}) => ({ date: '2027-01-12', kind: 'race', type: 'race', title: 'Made-up Ladder', platform: 'zwift', tentative: false, ...extra }) as const;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('zwift_route_course_test');
  await ensureIndexes(db);
  c = collections(db);
  routes = new ZwiftRouteCourses(c, new ZwiftRouteData(), { forUser: async (userId) => ({ zwiftAccount: userId === FLAGGED }) }, () => now);
  cal = new CalendarService(c, { intervalsFor: async () => null }, async () => 'Athlete', () => now, undefined, undefined, routes);
  await saveZwiftRoutes(c, [{ id: NEW_ROUTE, name: 'Made-up New Route', world: 'Watopia', distanceM: 10_000, ascentM: 100, leadinM: 500, leadinAscentM: 5 }], now);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.courses.deleteMany({}), c.calendarEvents.deleteMany({})]);
});

describe('a Zwift race’s route (DECISIONS #102)', () => {
  it('builds the course from the route and laps, with the named climbs', async () => {
    const e = await cal.create(FLAGGED, race({ zwiftRouteId: THREE_LITTLE_SISTERS, zwiftLaps: 2 }), { source: 'manual' });
    const course = (await cal.course(FLAGGED, e.id))!;
    expect(course).toMatchObject({ eventId: e.id, source: 'zwift', name: 'Three Little Sisters', route: { id: THREE_LITTLE_SISTERS, world: 'Watopia', laps: 2, lapsUnknown: false, hasProfile: true } });
    // The lead-in, then two laps.
    expect(course.analysis.distanceKm).toBeCloseTo(0.69 + 2 * 37.7, 0);
    const kom = course.analysis.climbs.filter((cl) => cl.name === 'Volcano KOM');
    expect(kom).toHaveLength(2);
    expect(course.segments!.filter((s) => s.name === 'Volcano KOM').map((s) => s.lap)).toEqual([1, 2]);
    // Stored nowhere: it's derived when read.
    expect(await c.courses.countDocuments({})).toBe(0);
    expect((await getEvent(c, FLAGGED, e.id))!.courseId).toBeUndefined();
  });

  it('measures close to the route’s published distance and climbing', async () => {
    const e = await cal.create(FLAGGED, race({ zwiftRouteId: BIG_LOOP, zwiftLaps: 1 }), { source: 'manual' });
    const { analysis } = (await cal.course(FLAGGED, e.id))!;
    const expectKm = 0.522 + 42.604;
    const expectUp = 1 + 662;
    expect(Math.abs(analysis.distanceKm - expectKm) / expectKm).toBeLessThan(0.05);
    expect(Math.abs(analysis.ascentM! - expectUp) / expectUp).toBeLessThan(0.05);
    expect(analysis.climbs.find((cl) => cl.name === 'Epic KOM')).toMatchObject({ lengthKm: expect.closeTo(9.4, 0) });
  });

  it('shows one lap when the race has no laps (a timed race), and follows a change of laps at once', async () => {
    const e = await cal.create(FLAGGED, race({ zwiftRouteId: VOLCANO_CIRCUIT }), { source: 'manual' });
    expect((await cal.course(FLAGGED, e.id))!.route).toMatchObject({ laps: 1, lapsUnknown: true });
    await cal.patch(FLAGGED, e.id, { zwiftLaps: 6 });
    const six = (await cal.course(FLAGGED, e.id))!;
    expect(six.route).toMatchObject({ laps: 6, lapsUnknown: false });
    expect(six.analysis.distanceKm).toBeCloseTo(2.758 + 6 * 4.1, 0);
  });

  it('gives the totals alone for a route with no heights', async () => {
    const e = await cal.create(FLAGGED, race({ zwiftRouteId: NEW_ROUTE, zwiftLaps: 3 }), { source: 'manual' });
    const course = (await cal.course(FLAGGED, e.id))!;
    expect(course.route).toMatchObject({ name: 'Made-up New Route', hasProfile: false });
    expect(course.analysis).toMatchObject({ distanceKm: 30.5, ascentM: 305, profile: [], climbs: [] });
  });

  it('is only for accounts with the Zwift feature', async () => {
    const e = await cal.create(OTHER, race({ zwiftRouteId: BIG_LOOP }), { source: 'manual' });
    expect(await cal.course(OTHER, e.id)).toBeNull();
    expect(await routes.options(OTHER)).toBeNull();
  });

  it('offers zwift-data’s routes and GameDictionary’s, marking which have a profile', async () => {
    const options = (await routes.options(FLAGGED))!;
    expect(options.find((r) => r.id === BIG_LOOP)).toMatchObject({ name: 'Big Loop', world: 'Watopia', distanceKm: 42.6, hasProfile: true });
    expect(options.find((r) => r.id === NEW_ROUTE)).toMatchObject({ hasProfile: false, leadinKm: 0.5 });
    expect(options.length).toBeGreaterThan(200);
  });

  it('keeps a GPX off a race that follows a route', async () => {
    const e = await cal.create(FLAGGED, race({ zwiftRouteId: BIG_LOOP }), { source: 'manual' });
    const input = { points: [[0, 10, 0, 0], [1, 20, 0, 0]] as [number, number, number, number][] };
    expect(await cal.putCourse(FLAGGED, e.id, input)).toEqual({ error: 'This race follows a Zwift route.', status: 400 });
  });

  it('clears with the route', async () => {
    const e = await cal.create(FLAGGED, race({ zwiftRouteId: BIG_LOOP, zwiftLaps: 2 }), { source: 'manual' });
    await cal.patch(FLAGGED, e.id, { unset: ['zwiftRouteId', 'zwiftLaps'] });
    const after = (await getEvent(c, FLAGGED, e.id))!;
    expect(after.zwiftRouteId).toBeUndefined();
    expect(after.zwiftLaps).toBeUndefined();
    expect(await cal.course(FLAGGED, e.id)).toBeNull();
  });
});
