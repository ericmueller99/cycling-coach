import type { UiBlock } from '@cycling-coach/shared';

/**
 * A dropped model call's output is whatever sits at the end: its text and its chips. `keepText`: a
 * handoff kept the words, so only the chips go. A build that couldn't run also takes back the
 * handoff marker in front of it, and stops there: the words before it were kept (DECISIONS #110).
 */
export function dropCall(blocks: UiBlock[], toolUseIds: string[], keepText = false): UiBlock[] {
  const kept = [...blocks];
  for (let last = kept.at(-1); last; last = kept.at(-1)) {
    const chip = last.type === 'tool' && toolUseIds.includes(last.toolUseId);
    if (!chip && (keepText || last.type !== 'text')) break;
    kept.pop();
  }
  if (!keepText && kept.at(-1)?.type === 'handoff') kept.pop();
  return kept;
}
