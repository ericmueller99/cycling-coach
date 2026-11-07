import { describe, expect, it } from 'vitest';
import { goalDateLabel, paceSummary } from './goals';

describe('goalDateLabel', () => {
  it('dates events, with the year', () => {
    expect(goalDateLabel({ event: true, targetDate: '2027-06-12' })).toBe('Jun 12, 2027');
  });

  it('shows nothing for any other goal, even with an old date stored', () => {
    expect(goalDateLabel({ targetDate: '2027-03-01' })).toBeUndefined();
    expect(goalDateLabel({ event: true })).toBeUndefined();
  });
});

describe('paceSummary', () => {
  const goal = { id: 'g', title: 'Race weight', measure: { kind: 'weight' as const }, target: 80, pace: { amount: 0.5, unit: 'kg' as const, per: 'week' as const } };
  const progress = { current: 85, target: 80, unit: 'kg', fraction: 80 / 85, label: 'Trend weight', onTrendWeight: true };

  it('shows the pace and when the target is reached at it', () => {
    expect(paceSummary({ ...goal, progress }, '2026-11-01')).toBe('0.5 kg/week · about Jan 10, 2027');
    expect(paceSummary({ ...goal, progress: { ...progress, current: 81 } }, '2026-11-01')).toBe('0.5 kg/week · about Nov 15');
  });

  it('shows just the pace with no trend weight, nothing without a pace', () => {
    expect(paceSummary(goal, '2026-11-01')).toBe('0.5 kg/week');
    expect(paceSummary({ ...goal, pace: undefined }, '2026-11-01')).toBeUndefined();
    expect(paceSummary({ ...goal, progress: { ...progress, current: 80.1 } }, '2026-11-01')).toBe('0.5 kg/week · at target');
  });
});
