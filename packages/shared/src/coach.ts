import { z } from 'zod';
import { calendarEventSchema, coachEventInputSchema, coachEventPatchSchema } from './calendar';
import { isoDateSchema, type IsoDate } from './common';
import { eventAims, eventWeights, goalMeasureSchema, trainingPreferenceSchema, weightPaceSchema } from './profile';
import { timeOffChangeSchema } from './time-off';

/**
 * Coach output the UI renders as cards. The API stores the verbatim Anthropic transcript and derives
 * these blocks from it, so the transcript stays the single source of truth (docs/DECISIONS.md #6).
 */

/** One row of a Plan card. Same shape as a calendar event, so "Add" is a straight copy. */
export const planItemSchema = coachEventInputSchema;
export type PlanItem = z.infer<typeof planItemSchema>;

export const proposalItemStatuses = ['pending', 'applied', 'dismissed'] as const;
export type ProposalItemStatus = (typeof proposalItemStatuses)[number];

export const calendarChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), event: coachEventInputSchema }),
  z.object({ op: z.literal('move'), eventId: z.string(), toDate: isoDateSchema }),
  z.object({
    op: z.literal('update'),
    eventId: z.string(),
    patch: coachEventPatchSchema,
  }),
  z.object({ op: z.literal('remove'), eventId: z.string() }),
]);
export type CalendarChange = z.infer<typeof calendarChangeSchema>;

/**
 * A row on a change card: a change to a session, or to time off. Wider than `calendarChangeSchema`,
 * which is what `propose_calendar_changes` takes; only `propose_time_off` writes the time off rows.
 */
export const proposalChangeSchema = z.union([calendarChangeSchema, timeOffChangeSchema]);
export type ProposalChange = z.infer<typeof proposalChangeSchema>;

export const profileUpdateSchema = z.object({
  ftpZwift: z.number().int().min(50).max(700).optional(),
  /** The monthly Zwift baseline. The real weight syncs from intervals.icu and isn't proposed. */
  zwiftWeightKg: z.number().min(30).max(200).optional(),
  trainingPreference: trainingPreferenceSchema.optional(),
  powerBests: z
    .array(
      z.object({
        period: z.enum(['90d', 'season', 'allTime']),
        durationSec: z.number().int().positive(),
        watts: z.number().int().min(0).max(3000),
        date: isoDateSchema.optional(),
        source: z.string().max(160).optional(),
      }),
    )
    .optional(),
  reason: z.string().max(300).optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Add a goal (no goalId) or replace an existing goal's fields (goalId). */
export const goalProposalSchema = z.object({
  goalId: z.string().optional(),
  horizon: z.enum(['long', 'short']),
  title: z.string().min(1).max(120),
  detail: z.string().max(500).optional(),
  /** Only for an event; every other goal is open-ended. */
  targetDate: isoDateSchema.optional(),
  event: z.boolean().optional(),
  measure: goalMeasureSchema.optional(),
  target: z.number().optional(),
  /** A weight goal's pace, from the safe list (DECISIONS #96). */
  pace: weightPaceSchema.optional(),
  /** The calendar event it's for; the goal is dated by the event (DECISIONS #100). */
  eventId: z.string().optional(),
  weight: z.enum(eventWeights).optional(),
  aim: z.enum(eventAims).optional(),
  primary: z.boolean().optional(),
});
export type GoalProposal = z.infer<typeof goalProposalSchema>;

export const proposalSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    threadId: z.string(),
    kind: z.literal('plan'),
    title: z.string(),
    subtitle: z.string().optional(),
    items: z.array(planItemSchema),
    itemStatus: z.array(z.enum(proposalItemStatuses)),
  }),
  z.object({
    id: z.string(),
    threadId: z.string(),
    kind: z.literal('calendar_changes'),
    title: z.string(),
    items: z.array(proposalChangeSchema),
    /**
     * The events as they were when the coach proposed the changes, parallel to `items` — null for
     * an add, a time off row, or an id that didn't resolve. A snapshot, so an applied change still shows its "before".
     * Absent on proposals made before it existed.
     */
    before: z.array(calendarEventSchema.nullable()).optional(),
    itemStatus: z.array(z.enum(proposalItemStatuses)),
  }),
  z.object({
    id: z.string(),
    threadId: z.string(),
    kind: z.literal('profile_update'),
    title: z.string(),
    items: z.array(profileUpdateSchema).length(1),
    itemStatus: z.array(z.enum(proposalItemStatuses)).length(1),
  }),
  z.object({
    id: z.string(),
    threadId: z.string(),
    kind: z.literal('goal'),
    title: z.string(),
    items: z.array(goalProposalSchema).length(1),
    itemStatus: z.array(z.enum(proposalItemStatuses)).length(1),
  }),
]);
export type Proposal = z.infer<typeof proposalSchema>;

/** A tool chip: what the coach fetched, collapsed to one line, expandable to rows. */
export interface ToolChipBlock {
  type: 'tool';
  toolUseId: string;
  name: string;
  status: 'running' | 'ok' | 'error' | 'expired';
  /** e.g. "Pulled 16 rides from intervals.icu · Oct 20 – 28 · 5 races, 10.1 h" */
  summary: string;
  /** Training-data tools (intervals.icu) get the data icon. */
  source: 'data' | 'app';
  rows?: string[] | undefined;
}

export type UiBlock =
  | { type: 'text'; text: string }
  | ToolChipBlock
  | { type: 'proposal'; proposalId: string; kind: Proposal['kind'] }
  | { type: 'workout'; workoutId: string }
  | {
      type: 'memory';
      memoryId: string;
      action: 'remember' | 'forget' | 'update';
      text: string;
      /** Set on a short-term note. */
      until?: IsoDate | undefined;
      /** An update's earlier text and date, for Undo. */
      previous?: { text: string; until?: IsoDate | undefined } | undefined;
    }
  /** Meal idea cards; the ideas live in `meal_ideas`. */
  | { type: 'meal_ideas'; ideasId: string }
  /** A generated recipe; it opens in the recipe pane and lives in `recipe_drafts`. */
  | { type: 'recipe_ref'; draftId: string }
  /** A Log this button: the athlete's words, opened in the food logger. Nothing is stored but the words. */
  | { type: 'food_log_offer'; phrase: string }
  /** The coach rewrote its outlook (DECISIONS #101); `previous` is what Undo puts back (none: clear it). */
  | { type: 'outlook'; text: string; previous?: string | undefined };

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: UiBlock[];
  createdAt: string;
  /** Assistant bubbles: the model that wrote last. */
  model?: string | undefined;
}

export const threadTags = ['food'] as const;
export type ThreadTag = (typeof threadTags)[number];

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  /** `food` once the coach has suggested meals or built a recipe in it. */
  tags: ThreadTag[];
  /** On the latest chat only: proposals still waiting on the athlete, so a new chat can point back at them. */
  openCards?: number | undefined;
}

/** A string, like every query param: the route turns it into a number. */
export const threadListQuerySchema = z.object({ limit: z.string().regex(/^[1-9]\d{0,2}$/).optional() });
/** The most chats one list asks for. */
export const THREAD_LIST_MAX = 500;

export const sendMessageSchema = z.object({
  text: z.string().min(1).max(8000),
  /** The Coach food strip's meal and day, when the user is planning food. */
  food: z.object({ slot: z.string().trim().min(1).max(30), date: isoDateSchema }).optional(),
  /** Run this one message on the build model, for a question that deserves it. */
  useBuildModel: z.boolean().optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** `build`: plans and workouts, on the stronger model. `chat`: everything else. */
export type CoachTier = 'chat' | 'build';

/** Why a coach turn or AI call won't run, and where to go about it. */
export interface TurnStop {
  message: string;
  action?: { label: string; href: string } | undefined;
}

export interface CoachUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * The SSE stream for one coach turn. The client appends `text_delta`s to the current text block and
 * replaces/inserts other blocks by identity (`toolUseId`, `proposalId`, ...).
 */
export type CoachEvent =
  | { type: 'turn_start'; messageId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking'; active: boolean }
  /** What the turn is busy with, for the working indicator: this tool, or none now that the tools are done. */
  | { type: 'working'; tool: string | null }
  | { type: 'block'; block: Exclude<UiBlock, { type: 'text' }> }
  | { type: 'thread_title'; title: string }
  | { type: 'done'; usage: CoachUsage }
  /** Take back what the model call being dropped showed: its text, and these tool chips. */
  | { type: 'discard'; toolUseIds: string[] }
  /** The turn moved to this model. `fallback`: the build model couldn't run, so it's the chat model. */
  | { type: 'model'; model: string; tier: CoachTier; fallback?: boolean }
  | { type: 'error'; message: string; retryable: boolean; action?: TurnStop['action'] };
