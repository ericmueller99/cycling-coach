/**
 * When a chat starts a new API context (DECISIONS #80). A context is the part of a chat sent to Claude:
 * a restart sends a fresh system prompt, a short recap and the new message, and nothing older. Stored
 * messages never change and the athlete still sees the whole chat.
 */

/** How long a cached prompt lasts, counted from the start of the request that wrote or read it. */
export const CACHE_TTL_MS = 5 * 60 * 1000;
/** A return to a chat this size restarts it: rewriting it costs more than a recap and a fresh start. */
export const RESTART_TOKENS = 80_000;
/** The ceiling, even mid-conversation. Also what limits a cold switch to the build model. */
export const HARD_TOKENS = 200_000;
/** A chat this size is offered a new chat. */
export const NUDGE_TOKENS = 60_000;
/** A chat left this long restarts whatever its size: the cut-off date. */
export const STALE_DAYS = 14;
/** Opening Coach, or coming back to it, reopens a chat only if it was active this recently (DECISIONS #82). */
export const LAND_IDLE_MINUTES = 30;
/** A new chat gets a recap of the latest chat from this far back. */
export const CARRY_DAYS = 7;
/** A chat this recent is probably the same conversation, so a new chat gets its last words too. */
export const CARRY_TAIL_HOURS = 12;
/** Longer than any one model call, so an unfinished message older than this belongs to a dead turn. */
export const TURN_IN_FLIGHT_MS = 20 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type RestartReason = 'tools' | 'repair' | 'size' | 'age';

export interface ContextState {
  /** The latest coach call's prompt and reply in this context; 0 when it hasn't had one. */
  tokens: number;
  lastMessageAt: Date;
  /** The tool definitions this context began with. Unset on chats from before contexts existed. */
  toolsHash: string | undefined;
  /** The tool definitions being sent now. */
  currentToolsHash: string;
  /** The context's last message, or null when it has none. */
  tail: { finished: boolean; at: Date } | null;
  /** A tool call in this context has no result, which the API rejects. */
  openToolUse: boolean;
  now: Date;
}

/** Why this turn should start a new context, or null to carry on in this one. */
export function restartReason(s: ContextState): RestartReason | null {
  if (!s.tail) return null;
  // Another tab's turn may be running. Restarting under it would strand its tool results.
  if (!s.tail.finished && s.now.getTime() - s.tail.at.getTime() < TURN_IN_FLIGHT_MS) return null;
  // Replayed thinking is tied to the tools it was written with, so a changed tool list is a 400 on
  // enforced accounts. Checked first: nothing else in this context can be sent until it's fixed.
  if (s.toolsHash !== s.currentToolsHash) return 'tools';
  if (s.openToolUse) return 'repair';
  if (s.tokens >= HARD_TOKENS) return 'size';
  const idle = s.now.getTime() - s.lastMessageAt.getTime();
  if (s.tokens >= RESTART_TOKENS && idle >= CACHE_TTL_MS) return 'size';
  if (idle >= STALE_DAYS * DAY_MS) return 'age';
  return null;
}

/** Opening Coach starts a new chat rather than reopening one last active at this time. */
export const landsOnNewChat = (lastMessageAt: Date, now: Date): boolean => now.getTime() - lastMessageAt.getTime() >= LAND_IDLE_MINUTES * MINUTE_MS;

/**
 * Coming back to a page left open on a chat, which never reloads, so `landsOnNewChat` never gets to
 * run. A long time away is half of it. The other half is that nothing arrived while they were gone:
 * a reply that landed is what they came back to read. Both times in that are the server's, so a
 * device with a wrong clock can't get it wrong.
 */
export const returnsToNewChat = (away: { hiddenAt: Date; latestAt: Date }, latestNow: Date, now: Date): boolean =>
  now.getTime() - away.hiddenAt.getTime() >= LAND_IDLE_MINUTES * MINUTE_MS && latestNow.getTime() <= away.latestAt.getTime();

/** How far back a chat can be and still give a new chat its recap. */
export const carrySince = (now: Date): Date => new Date(now.getTime() - CARRY_DAYS * DAY_MS);

/** A new chat from a chat this recent gets its last exchanges as well as a recap. */
export const carriesTail = (lastMessageAt: Date, now: Date): boolean => now.getTime() - lastMessageAt.getTime() < CARRY_TAIL_HOURS * HOUR_MS;
