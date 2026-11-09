import type { CalendarEvent } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { runTool, type CoachPorts, type NewProposal } from './tools';

/** Sat Nov 7 2026: the planning horizon is Sun Nov 22 (DECISIONS #98). */
const TODAY = '2026-11-07';

function ports(over: Partial<CoachPorts> = {}) {
  const createProposal = vi.fn(async (_p: NewProposal) => ({ id: 'prop1' })) as unknown as CoachPorts['createProposal'] & ReturnType<typeof vi.fn>;
  const all = { createProposal, getCalendarEvent: async () => null, ...over } as unknown as CoachPorts;
  return { ctx: { toolUseId: 'u1', today: TODAY, ports: all }, createProposal };
}

const ride = (date: string) => ({ date, kind: 'ride', type: 'endurance', title: 'Z2', durationMin: 90 });
const session = (over: Partial<CalendarEvent>) =>
  ({ id: 'e1', date: '2026-11-10', kind: 'workout', type: 'intervals', title: 'VO2 5×4', workoutId: 'w1', tentative: false, status: 'planned', source: 'coach', ...over }) as CalendarEvent;

describe('two-week blocks (DECISIONS #98)', () => {
  it('shows a plan that ends on the horizon', async () => {
    const { ctx, createProposal } = ports();
    const out = await runTool('propose_plan', { title: 'Next two weeks', items: [ride('2026-11-09'), ride('2026-11-22')] }, ctx);
    expect(out.isError).toBeFalsy();
    expect(createProposal).toHaveBeenCalledOnce();
  });

  it('refuses a plan past it, and tells the coach to explain the two-week blocks', async () => {
    const { ctx, createProposal } = ports();
    const out = await runTool('propose_plan', { title: 'To September', items: [ride('2026-11-09'), ride('2026-11-23'), ride('2026-11-30')] }, ctx);
    expect(out.isError).toBe(true);
    expect(createProposal).not.toHaveBeenCalled();
    expect(out.content).toContain('Mon Nov 23, Mon Nov 30 are past Sun Nov 22');
    expect(out.content).toContain('blocks of two weeks');
  });

  it('lets races, events and Zwift events the athlete picked go any distance ahead', async () => {
    const { ctx, createProposal } = ports();
    const fondo = { date: '2027-09-11', kind: 'race', type: 'race', title: 'Coast Range Gran Fondo', platform: 'garmin', eventInfo: { type: 'gran_fondo', distanceKm: 142 } };
    const zfondo = { ...ride('2026-12-05'), title: 'zFondo', zwiftEventId: 123 };
    const out = await runTool('propose_plan', { title: 'Events', items: [fondo, zfondo] }, ctx);
    expect(out.isError).toBeFalsy();
    expect(createProposal).toHaveBeenCalledOnce();
  });

  it('refuses moving a workout past it, but not a race', async () => {
    const workout = ports({ getCalendarEvent: async () => session({}) });
    expect((await runTool('propose_calendar_changes', { title: 'Push it back', changes: [{ op: 'move', eventId: 'e1', toDate: '2026-11-24' }] }, workout.ctx)).isError).toBe(true);
    expect(workout.createProposal).not.toHaveBeenCalled();

    const race = ports({ getCalendarEvent: async () => session({ kind: 'race', type: 'race', workoutId: undefined }) });
    expect((await runTool('propose_calendar_changes', { title: 'It moved', changes: [{ op: 'move', eventId: 'e1', toDate: '2027-01-24' }] }, race.ctx)).isError).toBeFalsy();
    expect(race.createProposal).toHaveBeenCalledOnce();
  });

  it('refuses an added ride or a re-dated one past it', async () => {
    const add = ports();
    expect((await runTool('propose_calendar_changes', { title: 'Add', changes: [{ op: 'add', event: ride('2026-12-01') }] }, add.ctx)).isError).toBe(true);

    const update = ports({ getCalendarEvent: async () => session({ kind: 'ride', type: 'endurance', workoutId: undefined }) });
    const out = await runTool('propose_calendar_changes', { title: 'Later', changes: [{ op: 'update', eventId: 'e1', patch: { date: '2026-11-29' } }] }, update.ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Sun Nov 29');
  });
});
