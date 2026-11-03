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

export const STARTER_WORKOUTS: WorkoutInput[] = [
  {
    name: 'VO2 5x4',
    category: 'VO2 max',
    description: '5 × 4 min @ 112% with 3.5 min easy. Shared warm-up and 10-min cool-down.',
    inZwift: true,
    segments: [
      ...STANDARD_WARMUP,
      { kind: 'repeat', count: 5, steps: [{ durSec: 240, pct: 112 }, { durSec: 210, pct: 50 }] },
      ...STANDARD_COOLDOWN,
    ],
  },
  {
    name: 'VO2 6x3',
    category: 'VO2 max',
    description: '6 × 3 min @ 116% with 3 min easy. Shared warm-up and 10-min cool-down.',
    inZwift: true,
    segments: [
      ...STANDARD_WARMUP,
      { kind: 'repeat', count: 6, steps: [{ durSec: 180, pct: 116 }, { durSec: 180, pct: 50 }] },
      ...STANDARD_COOLDOWN,
    ],
  },
  {
    name: 'VO2 30/15s 3x13',
    category: 'VO2 max',
    description: '3 sets of 13 × (30 s @ 135% / 15 s @ 50%), 5 min easy between sets.',
    inZwift: true,
    segments: [
      ...STANDARD_WARMUP,
      set3013,
      { kind: 'steady', durSec: 300, pct: 50 },
      set3013,
      { kind: 'steady', durSec: 300, pct: 50 },
      set3013,
      ...STANDARD_COOLDOWN,
    ],
  },
  {
    name: 'Surge and Settle 5x4',
    category: 'Race prep',
    description: '5 × (1 min @ 145% → 3 min @ 110%), 5 min easy between. Simulates race surges.',
    inZwift: true,
    segments: [
      ...STANDARD_WARMUP,
      ...Array.from({ length: 5 }).flatMap((_, i): WorkoutSegment[] => [
        { kind: 'repeat', count: 1, steps: [{ durSec: 60, pct: 145 }, { durSec: 180, pct: 110 }] },
        ...(i < 4 ? [{ kind: 'steady', durSec: 300, pct: 50 } as const] : []),
      ]),
      ...STANDARD_COOLDOWN,
    ],
  },
  RAMP_TEST,
];
