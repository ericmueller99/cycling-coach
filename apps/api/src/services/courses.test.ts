import { COURSE_ANALYSIS_VERSION, resampleTrack } from '@cycling-coach/core';
import { collections, ensureIndexes, getEvent, type Collections } from '@cycling-coach/db';
import type { CourseInput } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CalendarService } from './calendar';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;
let cal: CalendarService;

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const now = new Date('2026-11-07T12:00:00Z');

/** A made-up 12 km course due north: 4 km flat, 3 km at 6%, 5 km flat. */
function input(): CourseInput {
  const pts = [];
  let lat = 49;
  let ele = 100;
  for (const [km, grade] of [[4, 0], [3, 6], [5, 0]] as const) {
    for (let i = 0; i < km * 50; i++) {
      pts.push({ lat, lon: -123, ele });
      lat += 20 / 111_195;
      ele += (20 * grade) / 100;
    }
  }
  pts.push({ lat, lon: -123, ele });
  return { name: 'Made-up Hill Loop', fileName: 'hill-loop.gpx', points: resampleTrack(pts) };
}

const race = { date: '2027-06-12', kind: 'race', type: 'race', title: 'Made-up Road Race', platform: 'garmin', tentative: false, eventInfo: { type: 'road_race' } } as const;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('courses_test');
  await ensureIndexes(db);
  c = collections(db);
  cal = new CalendarService(c, { intervalsFor: async () => null }, async () => 'Athlete', () => now);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.courses.deleteMany({}), c.calendarEvents.deleteMany({})]);
});

describe('an event’s course (DECISIONS #99)', () => {
  it('is analysed here, not taken from the browser, and marks the event', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    const course = await cal.putCourse(U, e.id, input());
    expect(course).toMatchObject({ eventId: e.id, name: 'Made-up Hill Loop', fileName: 'hill-loop.gpx', analysis: { distanceKm: 12 } });
    expect((await cal.course(U, e.id))!.analysis.climbs).toHaveLength(1);
    expect((await getEvent(c, U, e.id))!.courseId).toBeTruthy();
  });

  it('replaces the course rather than adding a second', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    await cal.putCourse(U, e.id, input());
    await cal.putCourse(U, e.id, { ...input(), name: 'New route' });
    expect(await c.courses.countDocuments({ userId: U })).toBe(1);
    expect((await cal.course(U, e.id))!.name).toBe('New route');
  });

  it('only goes on a race', async () => {
    const ride = await cal.create(U, { date: '2027-06-12', kind: 'ride', type: 'endurance', title: 'Z2', tentative: false }, { source: 'manual' });
    expect(await cal.putCourse(U, ride.id, input())).toEqual({ error: 'Only an event has a course.', status: 400 });
    expect(await cal.putCourse(U, '0123456789abcdef01234567', input())).toBeNull();
  });

  it('can be removed, and goes when its event is deleted', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    await cal.putCourse(U, e.id, input());
    expect(await cal.removeCourse(U, e.id)).toBe(true);
    expect(await cal.course(U, e.id)).toBeNull();
    expect((await getEvent(c, U, e.id))!.courseId).toBeUndefined();

    await cal.putCourse(U, e.id, input());
    await cal.remove(U, e.id);
    expect(await c.courses.countDocuments({ userId: U })).toBe(0);
  });

  it('is analysed again when the analysis has changed since it was stored', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    await cal.putCourse(U, e.id, input());
    await c.courses.updateOne({ eventId: e.id }, { $set: { analysisVersion: 0, 'analysis.climbs': [] } });
    expect((await cal.course(U, e.id))!.analysis.climbs).toHaveLength(1);
    expect((await c.courses.findOne({ eventId: e.id }))!.analysisVersion).toBe(COURSE_ANALYSIS_VERSION);
  });
});
