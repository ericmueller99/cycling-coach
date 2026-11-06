import type { FoodLibrary } from '@cycling-coach/shared';

/**
 * Whether the next attempt to log opens the food intro (DECISIONS #88): once, and never for someone
 * who already logs. "Your foods start empty" would be news to nobody there, and going by what they've
 * logged needs no migration.
 */
export const shouldShowFoodIntro = (lib: Pick<FoodLibrary, 'introSeen' | 'usage'>) => !lib.introSeen && Object.keys(lib.usage).length === 0;
