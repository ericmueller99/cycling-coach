import { describe, expect, it } from 'vitest';
import { addDays, formatDayLabel, instantAt, monthGrid, nextDailyRun, planHorizonEnd, todayIn, weekStart } from './dates';

describe('dates', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-29')).toBe('2026-10-26'); // Thu → Mon
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // Sun belongs to the week before
  });

  it('crosses month and DST boundaries without drifting', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // DST ends Nov 1 in North America
  });

  it('builds the November 2026 month grid', () => {
    const grid = monthGrid(2026, 11);
    expect(grid[0]![0]).toBe('2026-10-26');
    expect(grid[grid.length - 1]![6]).toBe('2026-12-06');
    expect(grid).toHaveLength(6);
  });

  it('labels days like the plan card', () => {
    expect(formatDayLabel('2026-10-29')).toBe('Thu 29');
  });

  it("uses the athlete's local day", () => {
    // 05:00 UTC on Oct 30 is still Oct 29 in Vancouver.
    expect(todayIn('America/Vancouver', new Date('2026-10-30T05:00:00Z'))).toBe('2026-10-29');
  });
});

describe('planHorizonEnd (DECISIONS #98)', () => {
  // Mon Nov 9 2026 … Sun Nov 15 2026.
  it.each([
    ['2026-11-09', '2026-11-22', 13], // Mon: this week and next
    ['2026-11-10', '2026-11-22', 12],
    ['2026-11-11', '2026-11-29', 18], // Wed: room for the next two whole weeks
    ['2026-11-12', '2026-11-29', 17],
    ['2026-11-13', '2026-11-29', 16],
    ['2026-11-14', '2026-11-29', 15], // Sat: the next two weeks
    ['2026-11-15', '2026-11-29', 14],
  ])('from %s plans through %s', (today, end, days) => {
    expect(planHorizonEnd(today)).toBe(end);
    expect(weekStart(end)).toBe(addDays(end, -6)); // always a Sunday
    expect((Date.parse(end) - Date.parse(today)) / 86_400_000).toBe(days);
  });
});

describe('instantAt', () => {
  it('local wall-clock to an instant, across DST', () => {
    const ny = 'America/New_York';
    expect(instantAt('2026-07-01', '09:00', ny).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(instantAt('2026-12-01', '09:00', ny).toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(instantAt('2026-11-01', '05:00', ny).toISOString()).toBe('2026-11-01T10:00:00.000Z'); // fall-back day
    expect(instantAt('2026-11-01', '01:30', ny).toISOString()).toBe('2026-11-01T05:30:00.000Z'); // repeated → the first
    expect(instantAt('2026-03-08', '05:00', ny).toISOString()).toBe('2026-03-08T09:00:00.000Z'); // spring-forward day
    expect(instantAt('2026-03-08', '02:30', ny).toISOString()).toBe('2026-03-08T07:30:00.000Z'); // skipped → 03:30
    expect(instantAt('2026-06-15', '04:00', 'Europe/Amsterdam').toISOString()).toBe('2026-06-15T02:00:00.000Z');
    expect(instantAt('2026-12-01', '09:00', 'America/Vancouver').toISOString()).toBe(new Date('2026-12-01T09:00:00-07:00').toISOString());
  });
});

describe('nextDailyRun', () => {
  const tz = 'America/Vancouver';
  const local = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(d);
  const at = (now: string, rand: number) => nextDailyRun({ now: new Date(now), timeZone: tz, windowStart: '04:00', windowEnd: '07:00', rand });

  it('tomorrow inside the window once today’s has begun', () => {
    expect(local(at('2026-11-20T20:00:00Z', 0))).toBe('2026-11-21, 04:00');
    expect(local(at('2026-11-20T20:00:00Z', 0.5))).toBe('2026-11-21, 05:30');
    expect(local(at('2026-11-20T20:00:00Z', 0.9999))).toBe('2026-11-21, 06:59');
    expect(local(at('2026-11-20T13:00:00Z', 0.5))).toBe('2026-11-21, 05:30'); // 05:00 local, inside today's window
  });

  it('later today before the window opens', () => {
    expect(local(at('2026-11-20T10:00:00Z', 0.25))).toBe('2026-11-20, 04:45'); // 02:00 local
  });

  it('keeps local time over a DST change', () => {
    const ny = (now: string) => nextDailyRun({ now: new Date(now), timeZone: 'America/New_York', windowStart: '04:00', windowEnd: '07:00', rand: 0.5 });
    expect(ny('2026-10-31T20:00:00Z').toISOString()).toBe('2026-11-01T10:30:00.000Z'); // 05:30 EST
    expect(ny('2026-03-07T20:00:00Z').toISOString()).toBe('2026-03-08T09:30:00.000Z'); // 05:30 EDT
  });
});
