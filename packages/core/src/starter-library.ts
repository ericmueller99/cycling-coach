import type { WorkoutInput, WorkoutSegment } from '@cycling-coach/shared';

/**
 * The starter library: a few well-known workouts every new account gets (seed script), and handy
 * fixtures for tests.
 */

/** The default warm-up (the coach's too, unless memory says otherwise): 10 min ramp 50→75%, 2 min @75%, 1 min @110%, 4 min @55%. */
export const STANDARD_WARMUP: WorkoutSegment[] = [
  { kind: 'ramp', durSec: 600, fromPct: 50, toPct: 75 },
  { kind: 'steady', durSec: 120, pct: 75 },
  { kind: 'steady', durSec: 60, pct: 110 },
  { kind: 'steady', durSec: 240, pct: 55 },
];

/** 10 min easing down. */
export const STANDARD_COOLDOWN: WorkoutSegment[] = [
  { kind: 'ramp', durSec: 600, fromPct: 55, toPct: 45 },
];

const set3013: WorkoutSegment = {
  kind: 'repeat',
  count: 13,
  steps: [
    { durSec: 30, pct: 135 },
    { durSec: 15, pct: 50 },
  ],
};

/**
 * The first workout for an athlete who doesn't know their FTP (DECISIONS #62): a minute-by-minute
 * ramp ridden until they can't hold it. FTP ≈ 75% of the best one-minute power. The steps are % of
 * whatever FTP Zwift or intervals.icu has on file; where the ramp starts barely matters, because it
 * ends at failure.
 */
export const RAMP_TEST: WorkoutInput = {
  name: 'FTP Ramp Test',
  category: 'Test',
  description:
    'Ramp test: 5 min easy, then the target goes up every minute until you can no longer hold it — ride to failure. ' +
    'Your FTP is about 75% of your best one-minute power. Rest well the day before.',
  inZwift: true,
  segments: [
    { kind: 'steady', durSec: 300, pct: 50 },
    ...Array.from({ length: 16 }, (_, i): WorkoutSegment => ({ kind: 'steady', durSec: 60, pct: 60 + i * 6 })),
    { kind: 'ramp', durSec: 300, fromPct: 50, toPct: 40 },
  ],
};

/** A steady block. */
const at = (durSec: number, pct: number): WorkoutSegment => ({ kind: 'steady', durSec, pct });
/** `count` × (on, off), the usual interval set. */
const reps = (count: number, on: [number, number], off: [number, number]): WorkoutSegment => ({
  kind: 'repeat',
  count,
  steps: [
    { durSec: on[0], pct: on[1] },
    { durSec: off[0], pct: off[1] },
  ],
});
/** A structured session: the shared warm-up, the main set, the shared cool-down. */
const structured = (main: WorkoutSegment[]): WorkoutSegment[] => [...STANDARD_WARMUP, ...main, ...STANDARD_COOLDOWN];

/**
 * The starting library (DECISIONS #103): one or two of each kind of session, from easy to hard, so
 * the coach has something sensible for any goal and builds the rest. Listed to the coach in this
 * order. Every account gets it once, when its library is empty.
 */
export const STARTER_WORKOUTS: WorkoutInput[] = [
  {
    name: 'Endurance 60',
    category: 'Endurance',
    description: '50 min steady Z2 @ 68% between a short ramp up and down. Aerobic base.',
    inZwift: true,
    segments: [{ kind: 'ramp', durSec: 300, fromPct: 50, toPct: 65 }, at(3000, 68), { kind: 'ramp', durSec: 300, fromPct: 60, toPct: 45 }],
  },
  {
    name: 'Recovery Spin 30',
    category: 'Recovery',
    description: '30 min very easy, @ 52% at most. Leg-loosener after a hard day or race.',
    inZwift: true,
    segments: [{ kind: 'ramp', durSec: 300, fromPct: 40, toPct: 52 }, at(1200, 52), { kind: 'ramp', durSec: 300, fromPct: 52, toPct: 40 }],
  },
  {
    name: 'Tempo 3x12',
    category: 'Tempo',
    description: '3 × 12 min @ 82% with 4 min easy. Muscular endurance without much fatigue.',
    inZwift: true,
    segments: structured([reps(3, [720, 82], [240, 55])]),
  },
  {
    name: 'Sweet Spot 3x12',
    category: 'Sweet spot',
    description: '3 × 12 min @ 90% with 4 min easy. Raises FTP for the time spent.',
    inZwift: true,
    segments: structured([reps(3, [720, 90], [240, 55])]),
  },
  {
    name: 'Sweet Spot 2x20',
    category: 'Sweet spot',
    description: '2 × 20 min @ 90% with 5 min easy. Longer sustained efforts for FTP and long events.',
    inZwift: true,
    segments: structured([reps(2, [1200, 90], [300, 55])]),
  },
  {
    name: 'Threshold 3x10',
    category: 'Threshold',
    description: '3 × 10 min @ 98% with 5 min easy. Right at FTP.',
    inZwift: true,
    segments: structured([reps(3, [600, 98], [300, 55])]),
  },
  {
    name: 'Over-Unders 3x9',
    category: 'Threshold',
    description: '3 sets of 3 × (2 min @ 95% / 1 min @ 105%), 5 min easy between sets. Clearing fatigue at threshold.',
    inZwift: true,
    segments: structured([
      reps(3, [120, 95], [60, 105]),
      at(300, 55),
      reps(3, [120, 95], [60, 105]),
      at(300, 55),
      reps(3, [120, 95], [60, 105]),
    ]),
  },
  {
    name: 'VO2 5x4',
    category: 'VO2 max',
    description: '5 × 4 min @ 112% with 3.5 min easy. Shared warm-up and 10-min cool-down.',
    inZwift: true,
    segments: structured([reps(5, [240, 112], [210, 50])]),
  },
  {
    name: 'VO2 30/15s 3x13',
    category: 'VO2 max',
    description: '3 sets of 13 × (30 s @ 135% / 15 s @ 50%), 5 min easy between sets.',
    inZwift: true,
    segments: structured([set3013, at(300, 50), set3013, at(300, 50), set3013]),
  },
  {
    name: 'Surge and Settle 5x4',
    category: 'Race prep',
    description: '5 × (1 min @ 145% → 3 min @ 110%), 5 min easy between. Simulates race surges.',
    inZwift: true,
    segments: structured(
      Array.from({ length: 5 }).flatMap((_, i): WorkoutSegment[] => [
        { kind: 'repeat', count: 1, steps: [{ durSec: 60, pct: 145 }, { durSec: 180, pct: 110 }] },
        ...(i < 4 ? [at(300, 50)] : []),
      ]),
    ),
  },
  {
    name: 'Sprints 8x15s',
    category: 'Sprint',
    description: '8 × 15 s all-out sprints (target 180%) with about 5 min easy between. Top-end and race finishes.',
    inZwift: true,
    segments: structured([at(300, 65), reps(8, [15, 180], [285, 60])]),
  },
  {
    name: 'Openers 45',
    category: 'Openers',
    description: '2 min @ 95% and 3 × 30 s @ 130% in an easy ride. The day before a race.',
    inZwift: true,
    segments: [
      { kind: 'ramp', durSec: 600, fromPct: 50, toPct: 75 },
      at(300, 65),
      at(120, 95),
      at(180, 60),
      reps(3, [30, 130], [150, 55]),
      at(600, 65),
      { kind: 'ramp', durSec: 300, fromPct: 60, toPct: 45 },
    ],
  },
  RAMP_TEST,
];
