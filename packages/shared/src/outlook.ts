import { z } from 'zod';

/**
 * The coach's outlook (DECISIONS #101): a few lines on how it's balancing the athlete's goals and events
 * over the coming months, and why. The coach keeps it current with `update_outlook`; the athlete can
 * read, edit or clear it. It's never a schedule and never on the calendar.
 */
export const OUTLOOK_MAX = 800;

export const outlookInputSchema = z.object({ text: z.string().trim().min(1).max(OUTLOOK_MAX) });
export type OutlookInput = z.infer<typeof outlookInputSchema>;

/** Undo a coach's rewrite: back to `to` (null: there was none), only if it still says `from`. */
export const outlookRevertSchema = z.object({ from: z.string().max(OUTLOOK_MAX), to: z.string().max(OUTLOOK_MAX).nullable() });
export type OutlookRevert = z.infer<typeof outlookRevertSchema>;

export interface Outlook {
  text: string;
  /** ISO timestamp. */
  updatedAt: string;
  /** Who wrote it last. */
  source: 'coach' | 'user';
}
