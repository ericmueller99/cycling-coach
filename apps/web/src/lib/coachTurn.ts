import type { CoachUsage, SendMessageInput, UiBlock } from '@cycling-coach/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { keys } from './queries';
import { streamCoachTurn } from './sse';

/**
 * The coach turn being streamed, kept outside the Coach page (DECISIONS #46). A turn outlives the
 * page that started it: leaving Coach doesn't stop it, coming back shows it still running, and
 * nothing here ever navigates. When it finishes while the user is elsewhere, a notice says so
 * and they decide whether to go back.
 */

/** What started the turn, so the button that started it can say so ("Writing recipe…"). */
export type TurnOrigin = { kind: 'make'; ideaKey: string };

export interface LiveTurn {
  threadId: string;
  userText: string;
  /** Persisted message count when the turn started; once the refetch adds to it, the live copy hides. */
  baseCount: number;
  blocks: UiBlock[];
  thinking: boolean;
  /** The tool running now, for the working indicator. */
  runningTool?: string | undefined;
  /** Text has started streaming in. */
  writing: boolean;
  startedAt: number;
  origin?: TurnOrigin | undefined;
  /** A recipe the coach just built, for the Coach page to open (then cleared). */
  readyRecipe?: string | undefined;
  error?: { message: string; retryable: boolean } | undefined;
  done: boolean;
  usage?: CoachUsage | undefined;
}

/** "The coach replied" while the user was on another page or thread. */
export interface TurnNotice {
  threadId: string;
  recipeId?: string | undefined;
  error?: boolean | undefined;
}

const turns = new Map<string, LiveTurn>();
const aborts = new Map<string, AbortController>();
let notice: TurnNotice | null = null;
/** The thread the Coach page is showing, or null when it isn't mounted. */
let watching: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function update(threadId: string, fn: (t: LiveTurn) => LiveTurn) {
  const t = turns.get(threadId);
  if (!t) return;
  turns.set(threadId, fn(t));
  emit();
}

export function patchTurn(threadId: string, patch: Partial<LiveTurn>) {
  update(threadId, (t) => ({ ...t, ...patch }));
}

/** Drop a finished turn (its error, once the user has moved on). A running one stays. */
export function clearDoneTurn(threadId: string | undefined) {
  if (!threadId || !turns.get(threadId)?.done) return;
  turns.delete(threadId);
  emit();
}

export function abortTurn(threadId: string | undefined) {
  if (threadId) aborts.get(threadId)?.abort();
}

/** The Coach page says which thread it shows (null on unmount), so a finished turn knows if anyone saw it. */
export function setWatching(threadId: string | null) {
  watching = threadId;
  if (threadId && notice?.threadId === threadId) notice = null;
  emit();
}

export function dismissNotice() {
  notice = null;
  emit();
}

export const useLiveTurn = (threadId: string | undefined) =>
  useSyncExternalStore(subscribe, () => (threadId ? (turns.get(threadId) ?? null) : null));

/** Any turn still running — for the dot on the Coach tab. */
export const useAnyRunningTurn = () => useSyncExternalStore(subscribe, () => [...turns.values()].some((t) => !t.done));

export const useTurnNotice = () => useSyncExternalStore(subscribe, () => notice);

function applyBlock(blocks: UiBlock[], block: Exclude<UiBlock, { type: 'text' }>): UiBlock[] {
  if (block.type === 'tool') {
    const i = blocks.findIndex((b) => b.type === 'tool' && b.toolUseId === block.toolUseId);
    if (i !== -1) return blocks.map((b, j) => (j === i ? block : b));
  }
  return [...blocks, block];
}

function appendText(blocks: UiBlock[], text: string): UiBlock[] {
  const last = blocks[blocks.length - 1];
  if (last?.type === 'text') return [...blocks.slice(0, -1), { type: 'text', text: last.text + text }];
  return [...blocks, { type: 'text', text }];
}

/** Stream one turn into the store. Resolves when it's done and the thread has been refetched. */
export async function startTurn(opts: {
  threadId: string;
  input: SendMessageInput;
  baseCount: number;
  qc: QueryClient;
  origin?: TurnOrigin | undefined;
}): Promise<void> {
  const { threadId: id, input, qc } = opts;
  if (turns.get(id) && !turns.get(id)!.done) return;
  const abort = new AbortController();
  aborts.set(id, abort);
  turns.set(id, {
    threadId: id,
    userText: input.text,
    baseCount: opts.baseCount,
    blocks: [],
    thinking: true,
    writing: false,
    startedAt: Date.now(),
    origin: opts.origin,
    done: false,
  });
  emit();
  let recipeId: string | undefined;
  try {
    for await (const event of streamCoachTurn(id, input, abort.signal)) {
      switch (event.type) {
        case 'text_delta':
          update(id, (l) => ({ ...l, thinking: false, writing: true, blocks: appendText(l.blocks, event.text) }));
          break;
        case 'thinking':
          update(id, (l) => ({ ...l, thinking: event.active }));
          break;
        case 'block': {
          const b = event.block;
          if (b.type === 'recipe_ref') recipeId = b.draftId;
          update(id, (l) => ({
            ...l,
            thinking: false,
            blocks: applyBlock(l.blocks, b),
            ...(b.type === 'tool' ? { runningTool: b.status === 'running' ? b.name : undefined } : {}),
            // The Coach page opens it, if it's showing this thread (DECISIONS #46).
            ...(b.type === 'recipe_ref' ? { readyRecipe: b.draftId } : {}),
          }));
          break;
        }
        case 'thread_title':
          void qc.invalidateQueries({ queryKey: keys.threads });
          break;
        case 'error':
          update(id, (l) => ({ ...l, thinking: false, error: { message: event.message, retryable: event.retryable } }));
          break;
        case 'done':
          update(id, (l) => ({ ...l, usage: event.usage }));
          break;
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) update(id, (l) => ({ ...l, error: { message: (err as Error).message, retryable: true } }));
  }
  aborts.delete(id);
  // The turn is persisted; swap the live bubble for the stored version.
  update(id, (l) => ({ ...l, done: true, thinking: false, runningTool: undefined }));
  await qc.refetchQueries({ queryKey: keys.thread(id) });
  void qc.invalidateQueries({ queryKey: keys.threads });
  void qc.invalidateQueries({ queryKey: keys.dashboard });
  // A revised card closes the one it replaces.
  void qc.invalidateQueries({ queryKey: ['proposals'] });
  // A recipe built from an idea marks it Picked.
  void qc.invalidateQueries({ queryKey: ['coach-food'] });
  const failed = !!turns.get(id)?.error;
  if (watching !== id && !abort.signal.aborted) notice = { threadId: id, recipeId, error: failed };
  if (!failed) turns.delete(id);
  emit();
}
