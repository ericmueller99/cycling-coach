/** What a Claude call is for — the hosted version prices and limits them separately. */
export type AiUse = 'coach' | 'food_parse' | 'food_vision';

/**
 * Asked before a Claude call (DECISIONS #57). Returns a message to show instead, or null to go ahead.
 * Self-host never refuses; the hosted version checks the account's plan and month-to-date spend
 * (`ai_calls`). A coach turn is one check — the tools it runs (ingredient matching) ride on it.
 */
export type SpendGuard = (userId: string, use: AiUse) => Promise<string | null>;

export const allowSpend: SpendGuard = async () => null;
