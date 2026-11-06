import { collections, createEvent, ensureIndexes, getProposalDoc, listEvents, listTimeOff, type Collections } from '@cycling-coach/db';
import type { TimeOff } from '@cycling-coach/shared';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CalendarService } from './calendar';
import { applyProposal, createCoachProposal, dismissProposal } from './proposals';

let server: MongoMemoryServer;
let client: MongoClient;
let c: Collections;
let cal: CalendarService;

const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const now = new Date('2026-11-04T12:00:00Z');
const sick = { kind: 'sick', startDate: '2026-11-04', endDate: '2026-11-08' } as const;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db('time_off_test');
  await ensureIndexes(db);
  c = collections(db);
  cal = new CalendarService(c, { intervalsFor: async () => null }, async () => 'Athlete', () => now);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all([c.timeOff.deleteMany({}), c.calendarEvents.deleteMany({}), c.proposals.deleteMany({})]);
});

describe('listing', () => {
  it('finds an entry that overlaps the range at either end or runs right through it', async () => {
    await cal.addTimeOff(U, { kind: 'vacation', startDate: '2026-10-20', endDate: '2026-11-02' }, { source: 'manual' });
    await cal.addTimeOff(U, { kind: 'sick', startDate: '2026-11-30', endDate: '2026-12-03' }, { source: 'manual' });
    await cal.addTimeOff(U, { kind: 'vacation', startDate: '2026-10-01', endDate: '2026-12-31' }, { source: 'manual' });
    expect((await listTimeOff(c, U, '2026-11-01', '2026-11-30')).map((t) => t.startDate)).toEqual(['2026-10-01', '2026-10-20', '2026-11-30']);
  });

  it('leaves out what only touches the days around the range, and other athletes', async () => {
    await cal.addTimeOff(U, { kind: 'sick', startDate: '2026-10-29', endDate: '2026-10-31' }, { source: 'manual' });
    await cal.addTimeOff(U, { kind: 'sick', startDate: '2026-12-01', endDate: '2026-12-02' }, { source: 'manual' });
    await cal.addTimeOff('bbbbbbbbbbbbbbbbbbbbbbbb', sick, { source: 'manual' });
    expect(await listTimeOff(c, U, '2026-11-01', '2026-11-30')).toEqual([]);
  });
});

describe('editing', () => {
  it('checks the dates as they will end up, so one date on its own can not invert a range', async () => {
    const entry = await cal.addTimeOff(U, sick, { source: 'manual' });
    expect(await cal.patchTimeOff(U, entry.id, { endDate: '2026-11-01' })).toMatchObject({ status: 400 });
    expect(await cal.patchTimeOff(U, entry.id, { startDate: '2026-11-09' })).toMatchObject({ status: 400 });
    expect(await cal.patchTimeOff(U, entry.id, { endDate: '2026-11-10' })).toMatchObject({ startDate: '2026-11-04', endDate: '2026-11-10' });
  });

  it("can't touch another athlete's entry", async () => {
    const entry = await cal.addTimeOff(U, sick, { source: 'manual' });
    expect(await cal.patchTimeOff('bbbbbbbbbbbbbbbbbbbbbbbb', entry.id, { endDate: '2026-11-10' })).toBeNull();
    expect(await cal.removeTimeOff('bbbbbbbbbbbbbbbbbbbbbbbb', entry.id)).toBe(false);
    expect(await cal.removeTimeOff(U, entry.id)).toBe(true);
  });
});

describe('the coach card', () => {
  const threadId = new ObjectId();
  const session = (date: string) => createEvent(c, U, { date, kind: 'ride', type: 'endurance', title: `Ride ${date}`, tentative: false }, { source: 'coach' }, now);
  const card = (items: Parameters<typeof createCoachProposal>[3] extends infer P ? (P extends { kind: 'calendar_changes'; items: infer I } ? I : never) : never) =>
    createCoachProposal(c, U, threadId, { kind: 'calendar_changes', toolUseId: 'u1', title: 'Sick', items }, now);

  it('adds the entry and removes the sessions it was asked to, leaving a skipped row alone', async () => {
    const [a, b] = [await session('2026-11-05'), await session('2026-11-06')];
    const proposal = await card([{ op: 'time_off_add', entry: sick }, { op: 'remove', eventId: a.id }, { op: 'remove', eventId: b.id }]);
    await dismissProposal(c, U, proposal.id, [2]);
    const result = await applyProposal(c, cal, U, proposal.id, undefined, now);
    expect(result?.failed).toEqual([]);
    expect(result?.proposal.itemStatus).toEqual(['applied', 'applied', 'dismissed']);
    expect(await listTimeOff(c, U, '2026-11-04', '2026-11-08')).toMatchObject([{ kind: 'sick', source: 'coach', proposalId: proposal.id }]);
    expect((await listEvents(c, U, '2026-11-01', '2026-11-30')).map((e) => e.id)).toEqual([b.id]);
  });

  it('writes nothing until the athlete applies it', async () => {
    const a = await session('2026-11-05');
    await card([{ op: 'time_off_add', entry: sick }, { op: 'remove', eventId: a.id }]);
    expect(await listTimeOff(c, U, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(await listEvents(c, U, '2026-11-01', '2026-11-30')).toHaveLength(1);
  });

  it('snapshots the sessions on the card, and leaves the time off row empty', async () => {
    const a = await session('2026-11-05');
    const proposal = await card([{ op: 'time_off_add', entry: sick }, { op: 'remove', eventId: a.id }]);
    const doc = await getProposalDoc(c, U, proposal.id);
    expect(doc?.kind === 'calendar_changes' && doc.before?.map((e) => e?.id ?? null)).toEqual([null, a.id]);
  });

  const stored = (): Promise<TimeOff> => cal.addTimeOff(U, { ...sick, note: 'Head cold' }, { source: 'coach' });
  const was = { ...sick, note: 'Head cold' };

  it('applies an update as the whole entry, so a dropped note goes', async () => {
    const entry = await stored();
    const proposal = await card([{ op: 'time_off_update', timeOffId: entry.id, entry: { ...sick, endDate: '2026-11-10' }, was }]);
    await applyProposal(c, cal, U, proposal.id, undefined, now);
    const [after] = await listTimeOff(c, U, '2026-11-01', '2026-11-30');
    expect(after).toMatchObject({ endDate: '2026-11-10' });
    expect(after).not.toHaveProperty('note');
  });

  it('applies a removal, and reports a row whose entry has since gone', async () => {
    const entry = await stored();
    const proposal = await card([{ op: 'time_off_remove', timeOffId: entry.id, was }]);
    expect((await applyProposal(c, cal, U, proposal.id, undefined, now))?.failed).toEqual([]);
    expect(await listTimeOff(c, U, '2026-11-01', '2026-11-30')).toEqual([]);
    const again = await card([{ op: 'time_off_remove', timeOffId: entry.id, was }]);
    expect((await applyProposal(c, cal, U, again.id, undefined, now))?.failed).toEqual([0]);
  });
});
