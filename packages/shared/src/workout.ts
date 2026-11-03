import { z } from 'zod';

/** Power targets are integer percent of FTP (112 = 112%), never watts — watts follow FTP. */
const pct = z.number().int().min(0).max(300);
const durSec = z.number().int().min(1).max(6 * 3600);

export const workoutStepSchema = z.object({
  durSec,
  pct,
  cadence: z.number().int().min(30).max(150).optional(),
});
export type WorkoutStep = z.infer<typeof workoutStepSchema>;

/**
 * A workout is a list of segments rather than a flat step list, because a flat list
 * loses the repeat structure that `.zwo` needs (`IntervalsT`) and that the coach reasons in
 * ("6 × 3 min"). `core.flatten()` produces the flat form for charts.
 *
 * `repeat` takes any number of steps: "Surge and Settle" is a three-step repeat (surge, settle,
 * easy), which `.zwo` can only express by expanding — two-step repeats become `IntervalsT`.
 */
export const workoutSegmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('steady'),
    durSec,
    pct,
    cadence: z.number().int().min(30).max(150).optional(),
  }),
  z.object({ kind: z.literal('ramp'), durSec, fromPct: pct, toPct: pct }),
  z.object({
    kind: z.literal('repeat'),
    count: z.number().int().min(1).max(50),
    steps: z.array(workoutStepSchema).min(1).max(6),
  }),
]);
export type WorkoutSegment = z.infer<typeof workoutSegmentSchema>;

export const workoutCategories = ['VO2 max', 'Race prep', 'Threshold', 'Sweet spot', 'Endurance', 'Recovery', 'Openers', 'Sprint', 'Test'] as const;
export const workoutCategorySchema = z.enum(workoutCategories);
export type WorkoutCategory = z.infer<typeof workoutCategorySchema>;

export const workoutInputSchema = z.object({
  name: z.string().min(1).max(80),
  category: workoutCategorySchema,
  description: z.string().max(2000).optional(),
  segments: z.array(workoutSegmentSchema).min(1).max(60),
  inZwift: z.boolean().default(false),
  /** Set when the coach edits an existing workout — the original stays in the library. */
  basedOnId: z.string().optional(),
});
export type WorkoutInput = z.infer<typeof workoutInputSchema>;

export const workoutSchema = workoutInputSchema.extend({
  id: z.string(),
  source: z.enum(['seed', 'coach', 'manual', 'import']),
  createdAt: z.string(),
});
export type Workout = z.infer<typeof workoutSchema>;
