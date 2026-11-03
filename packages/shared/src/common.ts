import { z } from 'zod';

/** A calendar date with no time or zone, `YYYY-MM-DD`. Days are the athlete's local days. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export type IsoDate = z.infer<typeof isoDateSchema>;

/**
 * Session types drive colour everywhere. "Tentative" is not a type —
 * it is a flag on an event that renders with race colours and a dashed border.
 */
export const sessionTypes = ['race', 'intervals', 'openers', 'endurance', 'recovery'] as const;
export const sessionTypeSchema = z.enum(sessionTypes);
export type SessionType = z.infer<typeof sessionTypeSchema>;
