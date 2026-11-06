import { z } from 'zod';
import { isoDateSchema } from './common';
import { ftpSourceSchema, trainingPreferenceSchema, type Goal, type Memory } from './profile';

/**
 * First-run onboarding (DECISIONS #62): Fitness · Body · Goals · Memory · Sync, then a summary.
 * Each step is saved as the athlete continues, so a refresh resumes where they were.
 */
export const ONBOARDING_STEPS = ['fitness', 'body', 'goals', 'memory', 'sync'] as const;
export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number];
/** 0–4 are the steps above; 5 is the summary ("All set"). */
export const ONBOARDING_DONE_STEP = ONBOARDING_STEPS.length;

export const onboardingFitnessSchema = z.discriminatedUnion('known', [
  z.object({ known: z.literal(true), ftp: z.number().int().min(50).max(700), source: ftpSourceSchema }),
  z.object({ known: z.literal(false) }),
]);
export type OnboardingFitness = z.infer<typeof onboardingFitnessSchema>;

export const onboardingBodySchema = z.object({
  weightKg: z.number().min(30).max(200),
  /** How the athlete typed it; the profile always stores kg. */
  unit: z.enum(['kg', 'lb']),
  /** The browser's IANA zone; anything the server can't use falls back to UTC. */
  timezone: z.string().min(1).max(64),
});
export type OnboardingBody = z.infer<typeof onboardingBodySchema>;

/** The goal chips, in display order. */
export const onboardingGoalChips = ['ftp', 'power5', 'event', 'weight', 'consistent', 'fitter'] as const;
export type OnboardingGoalChip = (typeof onboardingGoalChips)[number];
export const ONBOARDING_GOAL_LABEL: Record<OnboardingGoalChip, string> = {
  ftp: 'Raise my FTP',
  power5: 'Improve my 5-minute power',
  event: 'Get ready for an event',
  weight: 'Reach a target weight',
  consistent: 'Ride more consistently',
  fitter: 'Just get fitter',
};

export const onboardingGoalsSchema = z
  .object({
    chips: z.array(z.enum(onboardingGoalChips)).max(onboardingGoalChips.length),
    main: z.object({ title: z.string().trim().min(1).max(120) }).optional(),
    /** Only with the `event` chip. */
    event: z.object({ name: z.string().trim().min(1).max(100), date: isoDateSchema }).optional(),
    preference: trainingPreferenceSchema.optional(),
  })
  .refine((g) => g.chips.length > 0 || g.main !== undefined, { message: 'Pick at least one goal' });
export type OnboardingGoals = z.infer<typeof onboardingGoalsSchema>;

export const onboardingStepSchema = z.object({ step: z.number().int().min(0).max(ONBOARDING_DONE_STEP) });

/** Everything the wizard needs to pick up where the athlete left off. */
export interface OnboardingState {
  /** The step to show: the first one not yet done. */
  step: number;
  fitness: OnboardingFitness | null;
  body: { weightKg: number; unit: 'kg' | 'lb' } | null;
  goals: OnboardingGoals | null;
  /** The goals the wizard created (shown on the summary). */
  createdGoals: Goal[];
  memories: Memory[];
  /** The ramp test booked by `finish`, when FTP was unknown. */
  rampTest: { date: string; eventId: string } | null;
  completedAt: string | null;
}
