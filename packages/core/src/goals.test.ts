import { describe, expect, it } from 'vitest';
import { goalProgress, type GoalSnapshot } from './goals';
import { inferSessionType } from './sessions';
import { STARTER_WORKOUTS, STANDARD_COOLDOWN, STANDARD_WARMUP } from './starter-library';

const snap: GoalSnapshot = {
  ftp: 345,
  weightKg: 84.3,
  zwiftWeightKg: 83,
  powerBests: [{ period: '90d', durationSec: 300, watts: 422 }],
  ctl: 64.5,
};

describe('goalProgress', () => {
  it('computes W/kg live on the Zwift weight', () => {
    expect(goalProgress({ measure: { kind: 'wkg', weight: 'zwift' }, target: 4.5 }, snap)).toEqual({
      current: 4.16,
      target: 4.5,
      unit: 'W/kg',
      fraction: 4.16 / 4.5,
      label: 'W/kg (Zwift weight)',
    });
  });

  it('falls back to trend weight when no Zwift weight is set', () => {
    const p = goalProgress({ measure: { kind: 'wkg', weight: 'zwift' }, target: 4.5 }, { ...snap, zwiftWeightKg: undefined });
    expect(p).toMatchObject({ current: 4.09, label: 'W/kg (trend weight)' });
  });

  it('measures zFTP and zMAP W/kg on the Zwift weight', () => {
    const s = { ...snap, zftp: 330, zmap: 420 };
    expect(goalProgress({ measure: { kind: 'zwift_wkg', metric: 'zftp' }, target: 4.2 }, s)).toMatchObject({
      current: 3.98,
      unit: 'W/kg',
      label: 'zFTP W/kg (Zwift weight)',
    });
    expect(goalProgress({ measure: { kind: 'zwift_wkg', metric: 'zmap' }, target: 5.1 }, s)).toMatchObject({ current: 5.06, label: 'zMAP W/kg (Zwift weight)' });
  });

  it('has no zFTP progress until zFTP is known', () => {
    expect(goalProgress({ measure: { kind: 'zwift_wkg', metric: 'zftp' }, target: 4.2 }, snap)).toBeUndefined();
  });

  it('reads synced power bests', () => {
    expect(goalProgress({ measure: { kind: 'power_best', durationSec: 300, period: '90d' }, target: 450 }, snap)).toMatchObject({
      current: 422,
      unit: 'W',
      label: '5 min best (90 days)',
    });
  });

  it('counts weight progress downwards', () => {
    expect(goalProgress({ measure: { kind: 'weight' }, target: 82 }, snap)?.fraction).toBeCloseTo(82 / 84.3);
  });

  it('is undefined without a measure, a target or the data', () => {
    expect(goalProgress({}, snap)).toBeUndefined();
    expect(goalProgress({ measure: { kind: 'fitness' }, target: 80 }, { ...snap, ctl: undefined })).toBeUndefined();
  });
});

describe('inferSessionType', () => {
  it('reads the seed library as intervals', () => {
    for (const w of STARTER_WORKOUTS) expect(inferSessionType(w.segments)).toBe('intervals');
  });

  it('spots endurance, recovery and openers', () => {
    expect(inferSessionType([{ kind: 'steady', durSec: 5400, pct: 70 }])).toBe('endurance');
    expect(inferSessionType([{ kind: 'steady', durSec: 1800, pct: 50 }])).toBe('recovery');
    expect(
      inferSessionType([...STANDARD_WARMUP, { kind: 'repeat', count: 3, steps: [{ durSec: 30, pct: 130 }, { durSec: 120, pct: 55 }] }, ...STANDARD_COOLDOWN]),
    ).toBe('openers');
  });
});
