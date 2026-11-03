import type { Collections, OnboardingDoc } from '../collections';
import { compact } from './util';

/** First-run onboarding state (DECISIONS #62). */
export async function getOnboarding(c: Collections, userId: string): Promise<OnboardingDoc | null> {
  return c.onboarding.findOne({ userId });
}

/**
 * Saves part of the wizard. `step` only moves forward: going back to edit a step and continuing
 * never rewinds where a refresh resumes.
 */
export async function saveOnboarding(
  c: Collections,
  userId: string,
  update: Partial<Pick<OnboardingDoc, 'fitness' | 'unit' | 'goals' | 'goalIds' | 'rampTest' | 'completedAt'>> & { step?: number },
  now: Date,
): Promise<OnboardingDoc> {
  const { step, ...fields } = update;
  const doc = await c.onboarding.findOneAndUpdate(
    { userId },
    {
      $set: { ...compact(fields), updatedAt: now },
      $max: { step: step ?? 0 },
      $setOnInsert: update.goalIds ? {} : { goalIds: [] },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!doc) throw new Error('onboarding upsert returned nothing');
  return doc;
}

/**
 * Whether the athlete is past onboarding: a finished wizard, or a profile made some other way (the
 * seed script, or an account from before onboarding existed).
 */
export async function isOnboarded(c: Collections, userId: string): Promise<boolean> {
  const doc = await c.onboarding.findOne({ userId }, { projection: { completedAt: 1 } });
  if (doc) return !!doc.completedAt;
  return (await c.profiles.countDocuments({ userId }, { limit: 1 })) > 0;
}
