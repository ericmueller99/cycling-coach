import type { WellnessDay } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { readinessFromWellness } from './readiness';

const TODAY = '2026-11-09';
/** `n` days of history before today, each with this HRV and resting HR. */
const history = (n: number, hrvMs: number, restingHr: number): WellnessDay[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(TODAY, -(n - i)), hrvMs, restingHr }));

describe('readinessFromWellness', () => {
  it("gives today's numbers against the athlete's own baselines, leaving today out of them", () => {
    const line = readinessFromWellness([...history(28, 60, 48), { date: TODAY, hrvMs: 41, restingHr: 56, sleepSec: 5.5 * 3600, sleepScore: 61 }], TODAY)!;
    expect(line).toContain('Readiness (intervals.icu wellness): HRV 41 ms (7-day 60, 28-day 60) · resting HR 56 (7-day 48, 28-day 48) · slept 5.5 h · sleep score 61');
    expect(line).toContain('ease off or swap to endurance');
  });

  it("says what the athlete entered in words, in each field's own direction", () => {
    const line = readinessFromWellness([{ date: TODAY, soreness: 4, fatigue: 3, mood: 1, motivation: 4, sleepQuality: 4 }], TODAY)!;
    expect(line).toContain('their own entries: sleep quality poor, soreness extreme, fatigue high, mood great, motivation low');
  });

  it("uses yesterday's reading when today has none yet, and nothing older", () => {
    expect(readinessFromWellness([{ date: addDays(TODAY, -1), hrvMs: 55 }], TODAY)).toContain('HRV 55 ms');
    expect(readinessFromWellness([{ date: addDays(TODAY, -2), hrvMs: 55 }], TODAY)).toBeNull();
    expect(readinessFromWellness([{ date: TODAY, ctl: 60, atl: 70 }], TODAY)).toBeNull();
  });

  it('says when there is too little history for a baseline', () => {
    const line = readinessFromWellness([...history(2, 60, 48), { date: TODAY, hrvMs: 50 }], TODAY)!;
    expect(line).toContain('HRV 50 ms · resting HR 48.');
    expect(line).toContain('Too few days yet');
  });
});
