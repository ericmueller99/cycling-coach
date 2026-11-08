import type { CalendarEvent, SessionFeedback } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { runTool, type CoachPorts } from './tools';

const session = (id: string, status: CalendarEvent['status']) =>
  ({ id, date: '2026-11-03', status, kind: 'workout', type: 'intervals', title: `VO2 ${id}`, tentative: false, source: 'coach' }) as CalendarEvent;
const fb = (over: Partial<SessionFeedback>): SessionFeedback => ({ id: 'f', date: '2026-11-03', title: 'VO2', createdAt: '', updatedAt: '', ...over });

const ctx = (over: Partial<CoachPorts>) => ({
  toolUseId: 'u1',
  today: '2026-11-07',
  ports: { listCalendar: async () => [], listTimeOff: async () => [], listFeedback: async () => [], ...over } as unknown as CoachPorts,
});

describe('reasons on missed and skipped sessions (DECISIONS #97)', () => {
  it('get_calendar shows why a session didn’t happen, and how a done one felt', async () => {
    const out = await runTool(
      'get_calendar',
      { start: '2026-11-01', end: '2026-11-07' },
      ctx({
        listCalendar: async () => [session('a', 'missed'), session('b', 'skipped'), session('c', 'done')],
        listFeedback: async () => [fb({ eventId: 'a', note: 'Power was out' }), fb({ eventId: 'b', note: 'Too busy' }), fb({ eventId: 'c', rpe: 6 })],
      }),
    );
    expect(out.content).toContain('VO2 a · missed · why: "Power was out"');
    expect(out.content).toContain('VO2 b · skipped · why: "Too busy"');
    expect(out.content).toContain('VO2 c · done · felt: RPE 6/10 (Moderate)');
  });

  it('get_ride_feedback leaves reasons out', async () => {
    const out = await runTool(
      'get_ride_feedback',
      { start: '2026-11-01', end: '2026-11-07' },
      ctx({ listFeedback: async () => [fb({ eventId: 'a', note: 'Sick' }), fb({ eventId: 'c', rpe: 6 })] }),
    );
    expect(out.content).toContain('1 rated ride');
    expect(out.content).not.toContain('Sick');
  });

  it('get_ride_feedback with only reasons says there are no ratings', async () => {
    const out = await runTool('get_ride_feedback', { start: '2026-11-01', end: '2026-11-07' }, ctx({ listFeedback: async () => [fb({ eventId: 'a', note: 'Sick' })] }));
    expect(out.content).toContain('No rated rides');
  });
});
