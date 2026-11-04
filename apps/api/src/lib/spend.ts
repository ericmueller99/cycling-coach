import type { TurnStop } from '@cycling-coach/shared';

/** What a Claude call is for — the hosted version prices and limits them separately. */
export type AiUse = 'coach' | 'food_parse' | 'food_vision';

/**
 * The answer to "may this call go ahead?". `build: false` keeps a coach turn on the chat model, and
 * `coachNote` goes in the turn's context so the coach can say why. A refusal carries what to show.
 */
export type SpendDecision =
  | { allow: true; build?: boolean; coachNote?: string }
  | ({ allow: false; code: string } & TurnStop);

/**
 * Asked before a Claude call (DECISIONS #57), and between the calls of a coach turn. Self-host never
 * refuses; the hosted version checks the account's plan and spend (`ai_calls`). A coach turn's tools
 * (ingredient matching) ride on its check.
 */
export type SpendGuard = (userId: string, use: AiUse) => Promise<SpendDecision>;

export const allowSpend: SpendGuard = async () => ({ allow: true });
