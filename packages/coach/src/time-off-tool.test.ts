import type { CalendarEvent, TimeOff } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { runTool, type CoachPorts, type NewProposal } from './tools';

const session = (id: string, date: string, status: CalendarEvent['status'] = 'planned') =>
  ({ id, date, status, kind: 'ride', type: 'endurance', title: `Ride ${id}`, tentative: false, source: 'coach' }) as CalendarEvent;
const sick: TimeOff = { id: 't1', kind: 'sick', startDate: '2026-11-04', endDate: '2026-11-06', note: 'Head cold', source: 'coach' };

function ports(over: Partial<CoachPorts> = {}) {
  const createProposal = vi.fn(async (_p: NewProposal) => ({ id: 'prop1' })) as unknown as CoachPorts['createProposal'] & ReturnType<typeof vi.fn>;
  const all = { createProposal, listCalendar: async () => [], getTimeOff: async () => null, ...over } as unknown as CoachPorts;
  return { ctx: { toolUseId: 'u1', today: '2026-11-04', ports: all }, createProposal };
}
const items = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls[0]![0] as Extract<NewProposal, { kind: 'calendar_changes' }>).items;

describe('propose_time_off', () => {
  const add = { title: 'Sick until Sunday', action: 'add', kind: 'sick', start: '2026-11-04', end: '2026-11-08' };

  it('shows a change card, with nothing written', async () => {
    const { ctx, createProposal } = ports();
    const out = await runTool('propose_time_off', add, ctx);
    expect(items(createProposal)).toEqual([{ op: 'time_off_add', entry: { kind: 'sick', startDate: '2026-11-04', endDate: '2026-11-08' } }]);
    expect(out.ui).toEqual({ type: 'proposal', proposalId: 'prop1', kind: 'calendar_changes' });
    expect(out.content).toContain('Nothing has changed yet');
  });

  it('offers to remove every planned session on those days, without being asked', async () => {
    const listCalendar = vi.fn(async () => [session('a', '2026-11-05'), session('b', '2026-11-07'), session('c', '2026-11-06', 'done')]);
    const { ctx, createProposal } = ports({ listCalendar });
    const out = await runTool('propose_time_off', add, ctx);
    expect(listCalendar).toHaveBeenCalledWith('2026-11-04', '2026-11-08');
    expect(items(createProposal).slice(1)).toEqual([
      { op: 'remove', eventId: 'a' },
      { op: 'remove', eventId: 'b' },
    ]);
    expect(out.content).toContain('Ride a (2026-11-05)');
  });

  it('leaves a session on a day already over alone', async () => {
    const { ctx, createProposal } = ports({ listCalendar: async () => [session('a', '2026-11-03')] });
    await runTool('propose_time_off', { ...add, start: '2026-11-02' }, ctx);
    expect(items(createProposal)).toHaveLength(1);
  });

  it('hands bad dates and a missing kind back to the coach', async () => {
    const { ctx, createProposal } = ports();
    expect((await runTool('propose_time_off', { ...add, end: '2026-11-01' }, ctx)).isError).toBe(true);
    expect((await runTool('propose_time_off', { title: 'x', action: 'add', start: '2026-11-04', end: '2026-11-05' }, ctx)).isError).toBe(true);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it('updates from what is stored, keeping the note, and offers the newly covered sessions', async () => {
    const { ctx, createProposal } = ports({ getTimeOff: async () => sick, listCalendar: async () => [session('a', '2026-11-08')] });
    await runTool('propose_time_off', { title: 'Longer', action: 'update', time_off_id: 't1', end: '2026-11-08' }, ctx);
    const was = { kind: 'sick', startDate: '2026-11-04', endDate: '2026-11-06', note: 'Head cold' };
    expect(items(createProposal)).toEqual([
      { op: 'time_off_update', timeOffId: 't1', entry: { ...was, endDate: '2026-11-08' }, was },
      { op: 'remove', eventId: 'a' },
    ]);
  });

  it('removes an entry, and offers nothing else', async () => {
    const listCalendar = vi.fn(async () => [session('a', '2026-11-05')]);
    const { ctx, createProposal } = ports({ getTimeOff: async () => sick, listCalendar });
    await runTool('propose_time_off', { title: 'Better', action: 'remove', time_off_id: 't1' }, ctx);
    expect(items(createProposal)).toEqual([{ op: 'time_off_remove', timeOffId: 't1', was: { kind: 'sick', startDate: '2026-11-04', endDate: '2026-11-06', note: 'Head cold' } }]);
    expect(listCalendar).not.toHaveBeenCalled();
  });

  it('refuses an id it can not find', async () => {
    const { ctx, createProposal } = ports();
    expect((await runTool('propose_time_off', { title: 'x', action: 'remove', time_off_id: 'nope' }, ctx)).isError).toBe(true);
    expect((await runTool('propose_time_off', { title: 'x', action: 'update' }, ctx)).isError).toBe(true);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it('closes the card it revises', async () => {
    const { ctx, createProposal } = ports();
    await runTool('propose_time_off', { ...add, replaces: 'old' }, ctx);
    expect(createProposal.mock.calls[0]![0]).toMatchObject({ replaces: 'old' });
  });
});

it('get_calendar shows time off with the sessions', async () => {
  const { ctx } = ports({ listCalendar: async () => [session('a', '2026-11-05')], listTimeOff: async () => [sick], listFeedback: async () => [] });
  const out = await runTool('get_calendar', { start: '2026-11-01', end: '2026-11-30' }, ctx);
  expect(out.content).toContain('Time off: t1 · Sick · Wed Nov 4 → Fri Nov 6 · Head cold');
  expect(out.content).toContain('Ride a');
});
