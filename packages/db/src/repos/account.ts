import type { Collections } from '../collections';

/** Every collection that holds an athlete's own data, under `userId`. */
export const USER_COLLECTIONS = [
  'profiles',
  'powerBests',
  'goals',
  'memories',
  'workouts',
  'calendarEvents',
  'timeOff',
  'threads',
  'messages',
  'proposals',
  'integrations',
  'zwiftEventMarks',
  'eventSearches',
  'sessionFeedback',
  'foods',
  'recipes',
  'meals',
  'foodLog',
  'foodSettings',
  'energySettings',
  'bodyScans',
  'mealIdeas',
  'recipeDrafts',
  'recipeShares',
  'activities',
  'wellness',
  'onboarding',
] as const satisfies readonly (keyof Collections)[];

/**
 * The rest, each for its own reason: shared data, Better Auth's own `users`, the job queue, and
 * `aiCalls`, which `deleteUserData` keeps as costs. A new collection goes in one list or the other,
 * and a test holds that.
 */
export const OTHER_COLLECTIONS = ['users', 'aiCalls', 'zwiftEvents', 'zwiftRoutes', 'syncState', 'cnfFoods', 'jobs'] as const satisfies readonly (keyof Collections)[];

/**
 * Delete everything an athlete has here, for a deployment closing their account (DECISIONS #95). The
 * one other exception to append-only transcripts (#93): the account is going, so nothing can be sent
 * again. Safe to repeat. AI costs stay, with nothing left to tie them to a chat: they hold no words.
 */
export async function deleteUserData(c: Collections, userId: string): Promise<void> {
  await Promise.all(USER_COLLECTIONS.map((name) => (c[name] as Collections['goals']).deleteMany({ userId })));
  await c.aiCalls.updateMany({ userId }, { $unset: { threadId: '', turnId: '' } });
}
