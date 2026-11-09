import { describe, expect, it } from 'vitest';
import { addDays, formatDayLabel, monthGrid, planHorizonEnd, todayIn, weekStart } from './dates';

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
