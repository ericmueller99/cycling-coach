import { describe, expect, it } from 'vitest';
import { trendChange, trendSeries, trendWeight, weekTrends, zwiftWeightDrift } from './weight';

it('ignores a one-off spike (median of the last 7 days)', () => {
  const r = trendWeight([
    { date: '2026-10-23', kg: 84.2 },
    { date: '2026-10-24', kg: 84.4 },
    { date: '2026-10-25', kg: 84.1 },
    { date: '2026-10-26', kg: 84.6 },
    { date: '2026-10-27', kg: 84.1 },
    { date: '2026-10-28', kg: 85.5 }, // pizza
  ]);
  expect(r).toEqual({ trendKg: 84.3, latest: { date: '2026-10-28', kg: 85.5 } });
});

it('uses only the 7 days up to the latest weigh-in', () => {
  const r = trendWeight([
    { date: '2026-10-01', kg: 90 },
    { date: '2026-10-02', kg: 90 },
    { date: '2026-10-26', kg: 84 },
    { date: '2026-10-27', kg: 84.2 },
    { date: '2026-10-28', kg: 84.4 },
  ]);
  expect(r?.trendKg).toBe(84.2);
});

it('falls back to the latest with fewer than 3 weigh-ins', () => {
  expect(trendWeight([{ date: '2026-10-27', kg: 84 }, { date: '2026-10-28', kg: 85.5 }])?.trendKg).toBe(85.5);
  expect(trendWeight([])).toBeNull();
});

it('flags a Zwift weight more than 2 kg off the trend', () => {
  expect(zwiftWeightDrift(undefined, 84.3)).toBeNull();
  expect(zwiftWeightDrift(86.3, 84.3)).toBeNull(); // exactly 2.0
  expect(zwiftWeightDrift(86.4, 84.3)).toBe(2.1);
  expect(zwiftWeightDrift(82.2, 84.3)).toBe(-2.1);
});

it('gives each weigh-in the trend as of that day, ending on the coaching weight', () => {
  const weighIns = [
    { date: '2026-10-25', kg: 84.1 },
    { date: '2026-10-23', kg: 84.2 },
    { date: '2026-10-24', kg: 84.4 },
    { date: '2026-10-26', kg: 84.6 },
    { date: '2026-10-28', kg: 85.5 },
  ];
  const series = trendSeries(weighIns);
  expect(series.map((p) => p.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-28']);
  // Under 3 weigh-ins the reading stands; from then on it's the median, so 85.5 barely moves it.
  expect(series.map((p) => p.trendKg)).toEqual([84.2, 84.4, 84.2, 84.3, 84.4]);
  expect(series.at(-1)!.trendKg).toBe(trendWeight(weighIns)!.trendKg);
});

it('measures the trend change over a window', () => {
  const points = [
    { date: '2026-10-01', trendKg: 83.8 },
    { date: '2026-10-14', trendKg: 83.9 },
    { date: '2026-10-20', trendKg: 84.1 },
    { date: '2026-10-28', trendKg: 84.5 },
  ];
  expect(trendChange(points, 14)).toBe(0.6); // from Oct 14, the last one at least 14 days back
  expect(trendChange(points, 90)).toBe(0.7); // shorter history: from the first point
  expect(trendChange(points.slice(0, 1), 14)).toBeUndefined();
});

describe('weekTrends', () => {
  const points = [
    { date: '2026-10-20', trendKg: 85.0 },
    { date: '2026-10-24', trendKg: 84.8 },
    { date: '2026-10-28', trendKg: 84.6 },
    { date: '2026-10-31', trendKg: 84.5 },
  ];
  it("takes each week's last trend point, today for the current week, nothing for future weeks", () => {
    expect(weekTrends(points, ['2026-10-19', '2026-10-26', '2026-11-02'], '2026-10-29')).toEqual([
      { start: '2026-10-19', trendKg: 84.8 },
      { start: '2026-10-26', trendKg: 84.6 },
      { start: '2026-11-02', trendKg: null },
    ]);
  });
  it('drops a stale trend', () => {
    expect(weekTrends(points, ['2026-11-16'], '2026-11-30')).toEqual([{ start: '2026-11-16', trendKg: null }]);
    expect(weekTrends(points, ['2026-11-02'], '2026-11-30')).toEqual([{ start: '2026-11-02', trendKg: 84.5 }]);
  });
});
