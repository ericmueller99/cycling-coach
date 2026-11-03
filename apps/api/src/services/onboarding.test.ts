import { RAMP_TEST, STARTER_WORKOUTS } from '@cycling-coach/core';
import { collections, ensureIndexes, getProfile, isOnboarded, listGoals, listWorkouts, saveProfile, type Collections } from '@cycling-coach/db';
import type { CalendarEvent, CalendarEventInput } from '@cycling-coach/shared';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { onboardingGoalInputs, OnboardingService, usableTimezone } from './onboarding';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('onboarding_test');
  await ensureIndexes(db);
  c = collections(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
// 23:30 UTC on Nov 3 is already Nov 4 in Auckland, so "tomorrow" there is Nov 5.
const NOW = new Date('2026-11-03T23:30:00Z');

/** Records what would go through the calendar service (and on to intervals.icu). */
function fakeCalendar() {
  const created: CalendarEventInput[] = [];
  return {
    created,
    create: async (_userId: string, input: CalendarEventInput) => {
      created.push(input);
      return { ...input, id: `e${created.length}`, status: 'planned', source: 'manual' } as unknown as CalendarEvent;
    },
  };
}

beforeEach(async () => {
  await Promise.all([c.onboarding.deleteMany({}), c.profiles.deleteMany({}), c.goals.deleteMany({}), c.workouts.deleteMany({}), c.memories.deleteMany({})]);
});

describe('OnboardingService (DECISIONS #62)', () => {
  it('counts an account with a profile but no wizard as onboarded, and a new one as not', async () => {
    expect(await isOnboarded(c, U)).toBe(false);
    await saveProfile(c, U, { ftpZwift: 250, weightKg: 70, weightSource: 'manual', timezone: 'UTC' }, NOW);
    expect(await isOnboarded(c, U)).toBe(true);
  });

  it('saves each step, so a refresh resumes where the athlete was', async () => {
    const s = new OnboardingService(c, fakeCalendar(), () => NOW);
    expect((await s.state(U)).step).toBe(0);

    let state = await s.saveFitness(U, { known: true, ftp: 276, source: 'zwift' });
    expect(state.step).toBe(1);
    expect(state.fitness).toEqual({ known: true, ftp: 276, source: 'zwift' });
    expect(await getProfile(c, U)).toBeNull();
    // Started, not finished.
    expect(await isOnboarded(c, U)).toBe(false);

    state = await s.saveBody(U, { weightKg: 164.5, unit: 'lb', timezone: 'Europe/London' });
    expect(state.step).toBe(2);
    expect(state.body).toEqual({ weightKg: 74.62, unit: 'lb' });
    expect(await getProfile(c, U)).toMatchObject({ ftpZwift: 276, ftpSource: 'zwift', weightKg: 74.62, weightSource: 'manual', timezone: 'Europe/London' });
    expect((await listWorkouts(c, U)).map((w) => w.name)).toEqual(STARTER_WORKOUTS.map((w) => w.name));

    // Going back to an earlier step never rewinds where a refresh resumes.
    state = await s.saveFitness(U, { known: true, ftp: 280, source: 'ramp' });
    expect(state.step).toBe(2);
    expect((await getProfile(c, U))?.ftpZwift).toBe(280);
  });

  it('replaces its own goals when the Goals step is saved again', async () => {
    const s = new OnboardingService(c, fakeCalendar(), () => NOW);
    await s.saveGoals(U, { chips: ['ftp', 'consistent'], main: { title: 'Raise my FTP to 300 W', date: '2027-03-01' } });
    let state = await s.saveGoals(U, { chips: ['event'], event: { name: 'Gran Fondo', date: '2027-06-12' } });
    expect(state.step).toBe(3);
    const goals = await listGoals(c, U);
    expect(goals.map((g) => g.title)).toEqual(['Get ready for Gran Fondo']);
    expect(state.createdGoals.map((g) => g.id)).toEqual(goals.map((g) => g.id));
    // A goal the athlete made elsewhere is never touched.
    await c.goals.insertOne({ userId: U, horizon: 'short', title: 'Mine', done: false, primary: false, createdAt: NOW });
    state = await s.saveGoals(U, { chips: ['fitter'] });
    expect((await listGoals(c, U)).map((g) => g.title).sort()).toEqual(['Just get fitter', 'Mine']);
  });

  it('books one ramp test for tomorrow in the athlete’s timezone when FTP is unknown', async () => {
    const calendar = fakeCalendar();
    const s = new OnboardingService(c, calendar, () => NOW);
    await s.saveFitness(U, { known: false });
    await s.saveBody(U, { weightKg: 70, unit: 'kg', timezone: 'Pacific/Auckland' });
    expect((await getProfile(c, U))?.ftpZwift).toBeUndefined();

    const done = await s.finish(U);
    expect('error' in done).toBe(false);
    expect(calendar.created).toHaveLength(1);
    expect(calendar.created[0]).toMatchObject({ date: '2026-11-05', kind: 'workout', title: RAMP_TEST.name });
    expect(calendar.created[0]!.workoutId).toBe((await listWorkouts(c, U)).find((w) => w.name === RAMP_TEST.name)?.id);
    expect(await isOnboarded(c, U)).toBe(true);

    // Finishing again (Edit → back to the summary) doesn't book a second one.
    await s.finish(U);
    expect(calendar.created).toHaveLength(1);
  });

  it('books nothing when FTP is known, and refuses to finish without a profile', async () => {
    const calendar = fakeCalendar();
    const s = new OnboardingService(c, calendar, () => NOW);
    await s.saveFitness(U, { known: true, ftp: 250, source: 'guess' });
    expect(await s.finish(U)).toEqual({ error: 'Add your weight first', status: 409 });
    await s.saveBody(U, { weightKg: 70, unit: 'kg', timezone: 'Not/AZone' });
    expect((await getProfile(c, U))?.timezone).toBe('UTC');
    await s.finish(U);
    expect(calendar.created).toHaveLength(0);
  });
});

describe('onboardingGoalInputs', () => {
  it('makes one main goal and folds the other chips into it', () => {
    expect(onboardingGoalInputs({ chips: ['ftp', 'consistent'], main: { title: 'Raise my FTP to 300 W', date: '2027-03-01' } })).toEqual([
      { horizon: 'long', title: 'Raise my FTP to 300 W', targetDate: '2027-03-01', detail: 'Focus: Raise my FTP · Ride more consistently', done: false, primary: true },
    ]);
    expect(onboardingGoalInputs({ chips: ['power5', 'fitter'] })).toEqual([
      { horizon: 'long', title: 'Improve my 5-minute power', detail: 'Also: Just get fitter', done: false, primary: true },
    ]);
  });

  it('adds the event as its own goal, main unless the athlete wrote one', () => {
    const goals = onboardingGoalInputs({ chips: ['event', 'ftp'], event: { name: 'Gran Fondo', date: '2027-06-12' } });
    expect(goals).toEqual([{ horizon: 'long', title: 'Get ready for Gran Fondo', targetDate: '2027-06-12', detail: 'Focus: Raise my FTP', done: false, primary: true }]);
    const withMain = onboardingGoalInputs({ chips: ['event'], main: { title: 'Podium' }, event: { name: 'Gran Fondo', date: '2027-06-12' } });
    expect(withMain.map((g) => [g.title, g.primary])).toEqual([
      ['Podium', true],
      ['Get ready for Gran Fondo', false],
    ]);
  });

  it('ignores event details without the event chip', () => {
    expect(onboardingGoalInputs({ chips: ['fitter'], event: { name: 'X', date: '2027-01-01' } }).map((g) => g.title)).toEqual(['Just get fitter']);
  });
});

describe('usableTimezone', () => {
  it('keeps a real zone and falls back to UTC', () => {
    expect(usableTimezone('America/Toronto')).toBe('America/Toronto');
    expect(usableTimezone('nope')).toBe('UTC');
  });
});
