import { collections, ensureIndexes, getGoal, type Collections } from '@cycling-coach/db';
import type { Goal } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CalendarService } from './calendar';
import { addGoal, changeGoal } from './goals';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;
let cal: CalendarService;

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const now = new Date('2026-11-07T12:00:00Z');
const race = { date: '2027-09-11', kind: 'race', type: 'race', title: 'Made-up Gran Fondo', platform: 'garmin', tentative: false, eventInfo: { type: 'gran_fondo' } } as const;
const goalFor = (eventId: string) => ({ horizon: 'long', title: 'Made-up Gran Fondo', eventId, weight: 'important', aim: 'compete', done: false, primary: false }) as const;
const ok = (g: unknown) => g as Goal;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('goals_test');
  await ensureIndexes(db);
  c = collections(db);
  cal = new CalendarService(c, { intervalsFor: async () => null }, async () => 'Athlete', () => now);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.goals.deleteMany({}), c.calendarEvents.deleteMany({})]);
});

describe('a goal for an event (DECISIONS #100)', () => {
  it('is an event goal dated by the event', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    const g = ok(await addGoal(c, U, { ...goalFor(e.id), targetDate: '2030-01-01' }, now));
    expect(g).toMatchObject({ event: true, targetDate: '2027-09-11', eventId: e.id, weight: 'important', aim: 'compete' });
  });

  it('is the only goal for that event, and only for a race on the calendar', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    await addGoal(c, U, goalFor(e.id), now);
    expect(await addGoal(c, U, goalFor(e.id), now)).toEqual({ error: 'That event already has a goal.', status: 409 });
    const ride = await cal.create(U, { date: '2027-09-10', kind: 'ride', type: 'endurance', title: 'Spin', tentative: false }, { source: 'manual' });
    expect(await addGoal(c, U, goalFor(ride.id), now)).toEqual({ error: 'That event isn’t on your calendar.', status: 400 });
  });

  it('moves when the event moves, and can’t be dated apart from it', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    const g = ok(await addGoal(c, U, goalFor(e.id), now));
    await cal.patch(U, e.id, { date: '2027-09-12' });
    expect((await getGoal(c, U, g.id))!.targetDate).toBe('2027-09-12');
    expect(ok(await changeGoal(c, U, g.id, { targetDate: '2027-01-01', weight: 'in_mind' }))).toMatchObject({ targetDate: '2027-09-12', weight: 'in_mind' });
  });

  it('stays when the event is deleted, unless the athlete asks for it to go', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    const g = ok(await addGoal(c, U, goalFor(e.id), now));
    await cal.remove(U, e.id);
    const kept = (await getGoal(c, U, g.id))!;
    expect(kept).toMatchObject({ event: true, targetDate: '2027-09-11' });
    expect(kept.eventId).toBeUndefined();

    const e2 = await cal.create(U, race, { source: 'manual' });
    const g2 = ok(await addGoal(c, U, goalFor(e2.id), now));
    await cal.remove(U, e2.id, { removeGoal: true });
    expect(await getGoal(c, U, g2.id)).toBeNull();
  });

  it('can be unlinked, and carries on unlinked when its event went some other way', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    const g = ok(await addGoal(c, U, goalFor(e.id), now));
    expect(ok(await changeGoal(c, U, g.id, { unset: ['eventId'] })).eventId).toBeUndefined();

    const g2 = ok(await changeGoal(c, U, g.id, { eventId: e.id }));
    expect(g2.eventId).toBe(e.id);
    await c.calendarEvents.deleteMany({});
    const after = ok(await changeGoal(c, U, g.id, { aim: 'finish' }));
    expect(after).toMatchObject({ aim: 'finish', targetDate: '2027-09-11' });
    expect(after.eventId).toBeUndefined();
  });

  it('a main event goal clears the old main, and keeps its weight to fall back to', async () => {
    const e = await cal.create(U, race, { source: 'manual' });
    const old = ok(await addGoal(c, U, { horizon: 'long', title: 'Raise 5-min power', done: false, primary: true }, now));
    const g = ok(await addGoal(c, U, { ...goalFor(e.id), primary: true }, now));
    expect((await getGoal(c, U, old.id))!.primary).toBe(false);
    expect(g).toMatchObject({ primary: true, weight: 'important' });
  });
});
