import type { CalendarEvent } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { runTool, type CoachPorts, type NewProposal } from './tools';

const TODAY = '2026-11-07';

/** The library: w1 is 75 min, w2 is 30 min. */
function ports(over: Partial<CoachPorts> = {}) {
  const createProposal = vi.fn(async (_p: NewProposal) => ({ id: 'prop1' })) as unknown as CoachPorts['createProposal'] & ReturnType<typeof vi.fn>;
  const library = new Map([
    ['w1', 4500],
    ['w2', 1800],
  ]);
  const workoutLengths = async (ids: string[]) => new Map(ids.flatMap((id) => (library.has(id) ? [[id, library.get(id)!] as const] : [])));
  const all = { createProposal, getCalendarEvent: async () => null, workoutLengths, ...over } as unknown as CoachPorts;
  return { ctx: { toolUseId: 'u1', today: TODAY, ports: all }, createProposal };
}

const workout = (workoutId: string, over: Record<string, unknown> = {}) => ({
  date: '2026-11-10',
  kind: 'workout',
  type: 'intervals',
  title: 'Sweet spot',
  workoutId,
  platform: 'zwift',
  ...over,
});
const sent = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0]![0] as NewProposal & { items: unknown[] };

describe('sessions point at real library workouts, at their length (DECISIONS #103)', () => {
  it('takes each workout session’s duration from its workout, whatever the coach wrote', async () => {
    const { ctx, createProposal } = ports();
    const out = await runTool(
      'propose_plan',
      { title: 'Week', items: [workout('w1', { durationMin: 60, durationLabel: '1 h' }), workout('w2'), { date: '2026-11-11', kind: 'ride', type: 'endurance', title: 'Z2', durationMin: 90 }] },
      ctx,
    );
    expect(out.isError).toBeFalsy();
    const items = sent(createProposal).items as { durationMin?: number; durationLabel?: string }[];
    expect(items.map((i) => i.durationMin)).toEqual([75, 30, 90]);
    expect(items[0]!.durationLabel).toBeUndefined();
  });

  it('shows nothing when a workout isn’t in the library, and tells the coach to create it', async () => {
    const { ctx, createProposal } = ports();
    const out = await runTool('propose_plan', { title: 'Week', items: [workout('w1'), workout('w9')] }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('w9 is not in their workout library');
    expect(out.content).toContain('create_workout');
    expect(createProposal).not.toHaveBeenCalled();
  });

  it('checks additions and workout swaps on the calendar too, and leaves other changes alone', async () => {
    const missing = ports();
    const bad = await runTool('propose_calendar_changes', { title: 'Swap', changes: [{ op: 'update', eventId: 'e1', patch: { workoutId: 'w9' } }] }, missing.ctx);
    expect(bad.isError).toBe(true);

    const { ctx, createProposal } = ports({ getCalendarEvent: async () => ({ id: 'e1', kind: 'workout' }) as CalendarEvent });
    const out = await runTool(
      'propose_calendar_changes',
      {
        title: 'Shorter today',
        changes: [
          { op: 'update', eventId: 'e1', patch: { workoutId: 'w2', durationMin: 45 } },
          { op: 'move', eventId: 'e2', toDate: '2026-11-12' },
          { op: 'add', event: workout('w1') },
        ],
      },
      ctx,
    );
    expect(out.isError).toBeFalsy();
    const [update, move, add] = sent(createProposal).items as Record<string, unknown>[];
    expect(update).toEqual({ op: 'update', eventId: 'e1', patch: { workoutId: 'w2', durationMin: 30 } });
    expect(move).toEqual({ op: 'move', eventId: 'e2', toDate: '2026-11-12' });
    expect((add!['event'] as { durationMin: number }).durationMin).toBe(75);
  });
});
