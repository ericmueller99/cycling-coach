import { describe, expect, it } from 'vitest';
import type { WorkoutInput } from '@cycling-coach/shared';
import { STANDARD_COOLDOWN, STANDARD_WARMUP, STARTER_WORKOUTS } from './starter-library';
import { chartBars, describeMainSet, describeTargets, workoutMetrics } from './workout';

/** A plain on/off VO2 session, no longer in the starter library. */
const VO2_6X3: WorkoutInput = {
  name: 'VO2 6x3',
  category: 'VO2 max',
  inZwift: true,
  segments: [...STANDARD_WARMUP, { kind: 'repeat', count: 6, steps: [{ durSec: 180, pct: 116 }, { durSec: 180, pct: 50 }] }, ...STANDARD_COOLDOWN],
};
const byName = (name: string) => [...STARTER_WORKOUTS, VO2_6X3].find((w) => w.name === name)!;

describe('starter library durations', () => {
  it.each([
    ['VO2 5x4', 3870], // 64.5 min
    ['VO2 6x3', 3780], // 63
    ['VO2 30/15s 3x13', 3975], // 66.25 — ~66
    ['Surge and Settle 5x4', 4020], // 67
    ['Endurance 60', 3600],
    ['Recovery Spin 30', 1800],
    ['Tempo 3x12', 4500], // 75
    ['Sweet Spot 3x12', 4500],
    ['Sweet Spot 2x20', 4620], // 77
    ['Threshold 3x10', 4320], // 72
    ['Over-Unders 3x9', 3840], // 64
    ['Sprints 8x15s', 4320], // 72
    ['Openers 45', 2640], // 44
  ])('%s is %i s', (name, sec) => {
    expect(workoutMetrics(byName(name).segments).totalSec).toBe(sec);
  });
});

describe('work / rest split', () => {
  it('counts the hard and easy halves of on/off repeats', () => {
    const m = workoutMetrics(byName('VO2 6x3').segments);
    expect(m.workSec).toBe(6 * 180);
    expect(m.restSec).toBe(6 * 180);
  });

  it('treats the easy blocks between sets as rest, and the warm-up opener as neither', () => {
    const m = workoutMetrics(byName('Surge and Settle 5x4').segments);
    expect(m.workSec).toBe(5 * 240); // surge and settle are both above threshold
    expect(m.restSec).toBe(4 * 300);
  });
});

describe('chartBars', () => {
  it('weights bars by minutes and caps height at 150%', () => {
    const bars = chartBars([
      { kind: 'steady', durSec: 120, pct: 75 },
      { kind: 'steady', durSec: 30, pct: 200 },
    ]);
    expect(bars).toEqual([
      { minutes: 2, heightPct: 50, color: '#3B8BF6', pct: 75 },
      { minutes: 0.5, heightPct: 100, color: '#EF4444', pct: 200 },
    ]);
  });

  it('draws ramps as stairs whose total length equals the ramp', () => {
    const bars = chartBars([{ kind: 'ramp', durSec: 600, fromPct: 50, toPct: 75 }]);
    expect(bars).toHaveLength(4);
    expect(bars.reduce((s, b) => s + b.minutes, 0)).toBeCloseTo(10);
    expect(bars[0]!.pct).toBeLessThan(bars[3]!.pct);
  });
});

describe('descriptions', () => {
  it('describes simple repeats', () => {
    expect(describeMainSet(byName('VO2 6x3').segments)).toBe('6 × 3 min @ 116% / 3 min @ 50%');
  });

  it('collapses repeated sets', () => {
    expect(describeMainSet(byName('VO2 30/15s 3x13').segments)).toBe(
      '3 sets of 13 × (30 s @ 135% / 15 s @ 50%)',
    );
    expect(describeMainSet(byName('Surge and Settle 5x4').segments)).toBe(
      '5 × (1 min @ 145% / 3 min @ 110%)',
    );
  });

  it('gives watt targets at the current FTP', () => {
    // The Library card: "Work 400 W · Rest 173 W" at FTP 345.
    expect(describeTargets(byName('VO2 6x3').segments, 345)).toBe('Work 400 W · Rest 173 W');
  });
});
