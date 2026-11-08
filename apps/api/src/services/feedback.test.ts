import { collections, createEvent, ensureIndexes, listFeedback, type Collections } from '@cycling-coach/db';
import type { CalendarEvent, SessionFeedback } from '@cycling-coach/shared';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CalendarService } from './calendar';
import { FeedbackService } from './feedback';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;
let cal: CalendarService;
let feedback: FeedbackService;

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const now = new Date('2026-11-07T12:00:00Z');
const range = { from: '2026-10-01', to: '2026-12-31' };

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('feedback_test');
  await ensureIndexes(db);
  c = collections(db);
  cal = new CalendarService(c, { intervalsFor: async () => null }, async () => 'Athlete', () => now);
  feedback = new FeedbackService(c, null, () => now);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.calendarEvents.deleteMany({}), c.sessionFeedback.deleteMany({})]);
});

/** A past ride session in a given state. Plain rides stay local, so nothing talks to intervals.icu. */
async function session(status: CalendarEvent['status'], date = '2026-11-05'): Promise<CalendarEvent> {
  const e = await createEvent(c, U, { date, kind: 'ride', type: 'endurance', title: 'Z2 ride', durationMin: 90, tentative: false }, { source: 'manual' }, now);
  if (status !== 'planned') await c.calendarEvents.updateOne({ _id: new ObjectId(e.id) }, { $set: { status } });
  return { ...e, status };
}
const stored = () => listFeedback(c, U, range);

describe('a reason on a missed or skipped session (DECISIONS #97)', () => {
  it('saves a note with no RPE on a missed session, and on a skipped one', async () => {
    const missed = await session('missed');
    const r = (await feedback.save(U, { eventId: missed.id, note: '  Sick with a cold ' })) as SessionFeedback;
    expect(r).toMatchObject({ eventId: missed.id, note: 'Sick with a cold', date: '2026-11-05', title: 'Z2 ride' });
    expect(r.rpe).toBeUndefined();

    await c.calendarEvents.deleteMany({});
    const skipped = await session('skipped');
    expect(await feedback.save(U, { eventId: skipped.id, note: 'Too busy' })).toMatchObject({ note: 'Too busy' });
  });

  it('refuses an RPE there, a planned session, and a done session or ride without an RPE', async () => {
    const missed = await session('missed');
    expect(await feedback.save(U, { eventId: missed.id, rpe: 5 })).toMatchObject({ status: 409 });
    await c.calendarEvents.deleteMany({});
    const planned = await session('planned');
    expect(await feedback.save(U, { eventId: planned.id, note: 'x' })).toMatchObject({ status: 409 });
    await c.calendarEvents.deleteMany({});
    const done = await session('done');
    expect(await feedback.save(U, { eventId: done.id, note: 'x' })).toMatchObject({ status: 400 });
    expect(await feedback.save(U, { activityId: 'i1', note: 'x' })).toMatchObject({ status: 400 });
    expect(await stored()).toEqual([]);
  });

  it('edits the note, and an empty one clears it', async () => {
    const missed = await session('missed');
    await feedback.save(U, { eventId: missed.id, note: 'Busy' });
    await feedback.save(U, { eventId: missed.id, note: 'Power was out' });
    expect((await stored()).map((f) => f.note)).toEqual(['Power was out']);
    expect(await feedback.save(U, { eventId: missed.id, note: ' ' })).toEqual({ cleared: true });
    expect(await stored()).toEqual([]);
  });

  it('goes when the session is set back by hand: undo Skip, Mark done', async () => {
    const skipped = await session('skipped');
    await feedback.save(U, { eventId: skipped.id, note: 'Legs were wrecked' });
    await cal.patch(U, skipped.id, { status: 'planned' });
    expect(await stored()).toEqual([]);

    await cal.patch(U, skipped.id, { status: 'missed' });
    await feedback.save(U, { eventId: skipped.id, note: 'Sick' });
    await cal.patch(U, skipped.id, { status: 'done' });
    expect(await stored()).toEqual([]);
  });

  it('moves with the session, and goes when the session is deleted', async () => {
    const missed = await session('missed');
    await feedback.save(U, { eventId: missed.id, note: 'Travel' });
    await cal.patch(U, missed.id, { date: '2026-11-06' });
    expect((await stored()).map((f) => f.date)).toEqual(['2026-11-06']);
    expect(await cal.remove(U, missed.id)).toEqual({ ok: true });
    expect(await stored()).toEqual([]);
  });

  it('is replaced by the first rating once the session was ridden after all', async () => {
    const missed = await session('missed');
    await feedback.save(U, { eventId: missed.id, note: 'Sick' });
    // A late upload: the sync marks it done directly, so the reason is still there.
    await c.calendarEvents.updateOne({ _id: new ObjectId(missed.id) }, { $set: { status: 'done' } });
    const rated = (await feedback.save(U, { eventId: missed.id, rpe: 4 })) as SessionFeedback;
    expect(rated).toMatchObject({ rpe: 4 });
    expect(rated.note).toBeUndefined();
    expect(await stored()).toHaveLength(1);
  });
});
