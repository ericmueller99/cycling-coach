import type { CalendarEvent, Course, Goal } from '@cycling-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import { renderEventsAhead, renderEventsBlock, renderOutlookBlock, renderTurnContext, type UpcomingEvent } from './context';
import { runTool, type CoachPorts } from './tools';

const fondo = {
  id: 'e7',
  date: '2027-09-11',
  kind: 'race',
  type: 'race',
  title: 'Coast Range Gran Fondo',
  platform: 'garmin',
  startTime: '07:00',
  priority: 'A',
  durationMin: 330,
  eventInfo: { type: 'gran_fondo', distanceKm: 142, ascentM: 1418 },
  tentative: false,
  status: 'planned',
  source: 'manual',
} as CalendarEvent;
const crit = { ...fondo, id: 'e9', date: '2026-11-17', title: 'Tuesday Night Crit', priority: 'C', startTime: '18:30', durationMin: undefined, eventInfo: { type: 'criterium', distanceKm: 40 } } as CalendarEvent;
const goal = { id: 'g1', horizon: 'long', title: 'Coast Range Gran Fondo', eventId: 'e7', weight: 'important', aim: 'compete', event: true, done: false, primary: false } as Goal;
const course: Course = {
  eventId: 'e7',
  fileName: 'coast-range.gpx',
  analysis: {
    distanceKm: 142,
    ascentM: 1418,
    descentM: 1018,
    minM: 120,
    maxM: 961,
    terrain: 'hilly',
    finishGainM: 178,
    climbs: [
      { n: 1, startKm: 38.1, lengthKm: 4.3, gainM: 211, avgPct: 5, maxPct: 6, topM: 513, longest: false },
      { n: 2, startKm: 95.9, lengthKm: 11.1, gainM: 700, avgPct: 6.3, maxPct: 7, topM: 961, longest: true },
    ],
    profile: [
      [0, 120],
      [71, 300],
      [142, 520],
    ],
  },
};
const events: UpcomingEvent[] = [{ event: crit }, { event: fondo, goal, course: course.analysis }];

describe('the coach’s view of events (DECISIONS #101)', () => {
  it('lists every event with absolute dates, its course in a line and how much it counts', () => {
    const block = renderEventsBlock(events);
    expect(block).toContain('- e9 · Tue Nov 17 2026 · Crit event 18:30 (C) · Tuesday Night Crit · 40 km · no goal: on the calendar only');
    expect(block).toContain(
      '- e7 · Sat Sep 11 2027 · Gran fondo event 07:00 (A) · Coast Range Gran Fondo · 142 km · 1,418 m · ~5 h 30 · course: 2 climbs, longest 11.1 km at 6.3% from km 95.9; last 20 km +178 m · goal: important, aim compete',
    );
    expect(block).not.toMatch(/in \d+ (weeks|days)/);
  });

  it('says how far off they are, every turn', () => {
    expect(renderEventsAhead(events, '2026-11-07')).toBe('Events ahead: Tuesday Night Crit (C, no goal) in 10 days; Coast Range Gran Fondo (A, important) in 44 weeks.');
  });

  it('sends the list and the outlook once, and says when they empty', () => {
    const base = { today: '2026-11-07', localTime: '9:14 PM', timezone: 'UTC', training: 'connected', athleteBlock: 'a', shortTermBlock: '', timeOffBlock: '', timeOffToday: '', calendarBlock: '' } as const;
    const eventsBlock = renderEventsBlock(events);
    const outlookBlock = renderOutlookBlock({ text: 'Main focus is 5-min power.', day: '2026-11-05', source: 'coach' });
    const first = renderTurnContext({ ...base, eventsBlock, outlookBlock, eventsAhead: 'Events ahead: x.', seen: { athlete: 'a' } });
    expect(first).toContain('# Upcoming events');
    expect(first).toContain('# Your outlook (written by you on Thu Nov 5 2026; keep it current with update_outlook)\nMain focus is 5-min power.');
    const again = renderTurnContext({ ...base, eventsBlock, outlookBlock, eventsAhead: 'Events ahead: x.', seen: { athlete: 'a', events: eventsBlock, outlook: outlookBlock } });
    expect(again).not.toContain('# Upcoming events');
    expect(again).not.toContain('# Your outlook');
    expect(again).toContain('Events ahead: x.');
    const emptied = renderTurnContext({ ...base, seen: { athlete: 'a', events: eventsBlock, outlook: outlookBlock } });
    expect(emptied).toContain('Upcoming events: none now.');
    expect(emptied).toContain('Your outlook: none now. It was cleared.');
  });
});

function ports(over: Partial<CoachPorts> = {}) {
  return { ctx: { toolUseId: 'u1', today: '2026-11-07', ports: over as CoachPorts } };
}

describe('get_event_course', () => {
  it('gives the climbs with this athlete’s times, and a chip', async () => {
    const { ctx } = ports({ getEventCourse: async () => ({ event: fondo, course, ftp: 345, weightKg: 72 }) });
    const out = await runTool('get_event_course', { event_id: 'e7', per_km: false }, ctx);
    expect(out.content).toContain('2 · km 95.9 · 11.1 km · 6.3% · max 7% · +700 m · ≈ 3');
    expect(out.content).toContain('(longest)');
    expect(out.content).toContain('estimates from FTP 345 W and 72 kg');
    expect(out.content).not.toContain('Elevation every km');
    expect(out.ui).toMatchObject({ type: 'tool', name: 'get_event_course', summary: 'Read the course · Coast Range Gran Fondo · 142 km · 1,418 m' });
  });

  it('adds the height every km when asked, and leaves times out without an FTP', async () => {
    const { ctx } = ports({ getEventCourse: async () => ({ event: fondo, course, weightKg: 72 }) });
    const out = await runTool('get_event_course', { event_id: 'e7', per_km: true }, ctx);
    expect(out.content).toContain('Elevation every km from the start (m): 120 123');
    expect(out.content).toContain('No FTP yet, so no climb times.');
  });

  it('says when there is no course, or no such event', async () => {
    expect((await runTool('get_event_course', { event_id: 'e9', per_km: false }, ports({ getEventCourse: async () => ({ event: crit, course: null, weightKg: 72 }) }).ctx)).content).toContain(
      'Tuesday Night Crit has no course yet (what’s known: Crit · 40 km)'.replace('’', "'"),
    );
    const missing = await runTool('get_event_course', { event_id: 'x', per_km: false }, ports({ getEventCourse: async () => null }).ctx);
    expect(missing.isError).toBe(true);
  });
});

describe('update_outlook', () => {
  it('saves it straight away, with what it said before for Undo', async () => {
    const setOutlook = vi.fn(async (text: string) => ({ outlook: { text, updatedAt: '', source: 'coach' as const }, previous: { text: 'Old', updatedAt: '', source: 'user' as const } }));
    const out = await runTool('update_outlook', { text: '  Main focus is 5-min power.  ' }, ports({ setOutlook }).ctx);
    expect(setOutlook).toHaveBeenCalledWith('Main focus is 5-min power.');
    expect(out.ui).toEqual({ type: 'outlook', text: 'Main focus is 5-min power.', previous: 'Old' });
  });

  it('refuses one that is too long', async () => {
    const setOutlook = vi.fn();
    const out = await runTool('update_outlook', { text: 'x'.repeat(801) }, ports({ setOutlook }).ctx);
    expect(out.isError).toBe(true);
    expect(setOutlook).not.toHaveBeenCalled();
  });
});
