import { z } from 'zod';
import { isoDateSchema } from './common';

/**
 * Days the athlete isn't training: away on vacation, or sick. Not sessions, so they live apart from
 * `calendar_events` and nothing that reads sessions (matching, missed, energy, the week's totals)
 * has to know about them. They stay in this app; intervals.icu never sees them (DECISIONS #87).
 */
export const timeOffKinds = ['vacation', 'sick'] as const;
export const timeOffKindSchema = z.enum(timeOffKinds);
export type TimeOffKind = z.infer<typeof timeOffKindSchema>;

export const TIME_OFF_LABEL: Record<TimeOffKind, string> = { vacation: 'Vacation', sick: 'Sick' };

/** The longest entry, in days, first and last included. */
export const TIME_OFF_MAX_DAYS = 366;

/** The fields without cross-field rules and without defaults, so a patch can be built from them (see `calendar.ts`). */
const timeOffFields = z.object({
  kind: timeOffKindSchema,
  startDate: isoDateSchema,
  /** The last day away, included. Same as `startDate` for a single day. */
  endDate: isoDateSchema,
  note: z.string().max(500).optional(),
});

const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** What's wrong with a date range, if anything. Patches check this against the merged entry. */
export function timeOffRangeError(startDate: string, endDate: string): string | null {
  if (endDate < startDate) return "The end date can't be before the start date.";
  if (utcDay(endDate) - utcDay(startDate) + 1 > TIME_OFF_MAX_DAYS) return `Time off can be at most ${TIME_OFF_MAX_DAYS} days.`;
  return null;
}

export const timeOffInputSchema = timeOffFields.superRefine((e, ctx) => {
  const message = timeOffRangeError(e.startDate, e.endDate);
  if (message) ctx.addIssue({ code: 'custom', path: ['endDate'], message });
});
export type TimeOffInput = z.infer<typeof timeOffInputSchema>;

export const timeOffSchema = timeOffFields.extend({
  id: z.string(),
  source: z.enum(['coach', 'manual']),
  proposalId: z.string().optional(),
});
export type TimeOff = z.infer<typeof timeOffSchema>;

export const timeOffPatchSchema = timeOffFields.partial().extend({
  /** Fields to remove. A field both set and unset keeps the set value. */
  unset: z.array(z.literal('note')).optional(),
});
export type TimeOffPatch = z.infer<typeof timeOffPatchSchema>;

/**
 * Time off rows on a change card. `was` is the entry when the coach proposed the change, so an
 * applied row still shows what it replaced. The tool fills it in; the coach never sends it.
 */
export const timeOffChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('time_off_add'), entry: timeOffInputSchema }),
  z.object({ op: z.literal('time_off_update'), timeOffId: z.string(), entry: timeOffInputSchema, was: timeOffFields }),
  z.object({ op: z.literal('time_off_remove'), timeOffId: z.string(), was: timeOffFields }),
]);
export type TimeOffChange = z.infer<typeof timeOffChangeSchema>;
