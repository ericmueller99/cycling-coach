import type { WorkoutSegment, WorkoutStep } from '@cycling-coach/shared';
import { watts, zoneColor } from './zones';

/** One flat step. `pctEnd` is set for ramps. */
export interface FlatStep {
  durSec: number;
  pct: number;
  pctEnd?: number;
  /** Part of a repeat block's hard step — feeds the Work/Rest tiles. */
  role: 'work' | 'rest' | 'other';
}

/** Steps at or above this % FTP inside a repeat count as work even when they aren't the peak. */
const WORK_PCT = 88;
/** A standalone steady block counts as work if it's this hard for at least this long (2 × 20 etc). */
const STANDALONE_WORK_MIN_SEC = 180;

export function flatten(segments: readonly WorkoutSegment[]): FlatStep[] {
  const out: FlatStep[] = [];
  segments.forEach((seg, i) => {
    if (seg.kind === 'steady') {
      // An easy block sandwiched between two repeat blocks is the recovery between sets.
      const betweenSets =
        segments[i - 1]?.kind === 'repeat' && segments[i + 1]?.kind === 'repeat';
      const role =
        seg.pct >= WORK_PCT && seg.durSec >= STANDALONE_WORK_MIN_SEC
          ? 'work'
          : betweenSets
            ? 'rest'
            : 'other';
      out.push({ durSec: seg.durSec, pct: seg.pct, role });
    } else if (seg.kind === 'ramp') {
      out.push({ durSec: seg.durSec, pct: seg.fromPct, pctEnd: seg.toPct, role: 'other' });
    } else {
      const peak = Math.max(...seg.steps.map((s) => s.pct));
      for (let i = 0; i < seg.count; i++) {
        for (const step of seg.steps) {
          const role = step.pct === peak || step.pct >= WORK_PCT ? 'work' : 'rest';
          out.push({ durSec: step.durSec, pct: step.pct, role });
        }
      }
    }
  });
  return out;
}

export interface WorkoutMetrics {
  totalSec: number;
  workSec: number;
  restSec: number;
  /** Highest target, for the chart's y-scale and "peak" labels. */
  maxPct: number;
}

export function workoutMetrics(segments: readonly WorkoutSegment[]): WorkoutMetrics {
  const steps = flatten(segments);
  let totalSec = 0;
  let workSec = 0;
  let restSec = 0;
  let maxPct = 0;
  for (const s of steps) {
    totalSec += s.durSec;
    if (s.role === 'work') workSec += s.durSec;
    if (s.role === 'rest') restSec += s.durSec;
    maxPct = Math.max(maxPct, s.pct, s.pctEnd ?? 0);
  }
  return { totalSec, workSec, restSec, maxPct };
}

/** A bar in the interval-profile chart. */
export interface ChartBar {
  /** Flex weight — minutes. */
  minutes: number;
  /** 0–100, `min(pct, 150) / 150`. */
  heightPct: number;
  color: string;
  pct: number;
}

/** Ramps are drawn as stairs of at most this many seconds each. */
const RAMP_STAIR_SEC = 150;
const CHART_CEILING_PCT = 150;

export function chartBars(segments: readonly WorkoutSegment[]): ChartBar[] {
  const bars: ChartBar[] = [];
  const push = (durSec: number, pct: number) =>
    bars.push({
      minutes: durSec / 60,
      heightPct: Math.round((Math.min(pct, CHART_CEILING_PCT) / CHART_CEILING_PCT) * 100),
      color: zoneColor(pct),
      pct,
    });

  for (const step of flatten(segments)) {
    if (step.pctEnd === undefined) {
      push(step.durSec, step.pct);
      continue;
    }
    const stairs = Math.max(1, Math.ceil(step.durSec / RAMP_STAIR_SEC));
    for (let i = 0; i < stairs; i++) {
      // Each stair sits at the ramp's value at the stair's midpoint.
      const t = (i + 0.5) / stairs;
      push(step.durSec / stairs, Math.round(step.pct + (step.pctEnd - step.pct) * t));
    }
  }
  return bars;
}

export function formatStepDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const min = sec / 60;
  return Number.isInteger(min) ? `${min} min` : `${Math.round(min * 10) / 10} min`;
}

/** Whole-workout length as shown on cards: "63 min". */
export function formatWorkoutDuration(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

function describeStep(step: WorkoutStep): string {
  return `${formatStepDuration(step.durSec)} @ ${step.pct}%`;
}

/**
 * The main-set line on cards, e.g. "6 × 3 min @ 116% / 3 min @ 50%". Identical repeat blocks
 * separated by easy gaps collapse: count-1 blocks become "5 × (…)" (Surge and Settle), and
 * multi-rep blocks become "3 sets of 13 × (…)" (30/15s).
 */
export function describeMainSet(segments: readonly WorkoutSegment[]): string {
  const repeats = segments.filter((s) => s.kind === 'repeat');
  if (repeats.length === 0) {
    const hardest = segments
      .filter((s) => s.kind === 'steady')
      .sort((a, b) => b.pct - a.pct)[0];
    return hardest ? describeStep(hardest) : '';
  }

  const groups: { inner: string; count: number; multiStep: boolean; sets: number }[] = [];
  for (const r of repeats) {
    const inner =
      r.steps.length === 2
        ? `${describeStep(r.steps[0]!)} / ${describeStep(r.steps[1]!)}`
        : r.steps.map(describeStep).join(' → ');
    const last = groups[groups.length - 1];
    if (last && last.inner === inner && last.count === r.count) last.sets++;
    else groups.push({ inner, count: r.count, multiStep: r.steps.length > 1, sets: 1 });
  }
  return groups
    .map((g) => {
      const wrapped = g.multiStep ? `(${g.inner})` : g.inner;
      if (g.sets === 1) return `${g.count} × ${g.inner}`;
      if (g.count === 1) return `${g.sets} × ${wrapped}`;
      return `${g.sets} sets of ${g.count} × ${wrapped}`;
    })
    .join(' · ');
}

/** "Work 400 W · Rest 173 W" style target line at the current FTP. */
export function describeTargets(segments: readonly WorkoutSegment[], ftp: number): string {
  const steps = flatten(segments);
  const work = steps.filter((s) => s.role === 'work');
  const rest = steps.filter((s) => s.role === 'rest');
  const parts: string[] = [];
  const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => b - a);
  const workPcts = uniq(work.map((s) => s.pct));
  if (workPcts.length) parts.push(`Work ${workPcts.map((p) => `${watts(p, ftp)} W`).join(' / ')}`);
  const restPcts = uniq(rest.map((s) => s.pct));
  if (restPcts.length) parts.push(`Rest ${restPcts.map((p) => `${watts(p, ftp)} W`).join(' / ')}`);
  return parts.join(' · ');
}
