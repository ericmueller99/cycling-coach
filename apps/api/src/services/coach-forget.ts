import type { Collections } from '@cycling-coach/db';
import type { ObjectId } from 'mongodb';

/**
 * Removing what only Claude saw from stored chats (DECISIONS #93). It has to follow `forgetContexts`,
 * because a stored message may only change once it can't be sent again.
 */

interface ClearRule {
  /** Text that marks a tool result as holding this source's data. */
  marker: string;
  /** What's left in its place. */
  note: string;
}

const isBlock = (b: unknown, type: string): b is Record<string, unknown> => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === type;

/**
 * One stored message with what only Claude saw taken out, or null when there's nothing to change.
 * Context messages and tool results are never shown, so they go whole, which also takes any figures
 * worked out from the data. What the athlete typed and the coach's words stay.
 */
export function clearedMessage(
  doc: { kind: string; content: unknown[]; ui?: { type: string; toolUseId?: string; rows?: unknown; summary?: string }[] | undefined },
  rule: ClearRule,
): { content: unknown[]; ui?: unknown[] } | null {
  if (doc.kind === 'context') {
    return doc.content.length === 1 && isBlock(doc.content[0], 'text') && doc.content[0]['text'] === rule.note ? null : { content: [{ type: 'text', text: rule.note }] };
  }
  if (doc.kind === 'assistant') {
    const kept = doc.content.filter((b) => !isBlock(b, 'thinking') && !isBlock(b, 'redacted_thinking'));
    return kept.length === doc.content.length ? null : { content: kept };
  }
  if (doc.kind !== 'tool_results') return null;
  const marked = new Set(
    doc.content.flatMap((b) => (isBlock(b, 'tool_result') && JSON.stringify(b['content'] ?? '').includes(rule.marker) ? [String(b['tool_use_id'])] : [])),
  );
  const content = doc.content.map((b) => (isBlock(b, 'tool_result') ? { ...b, content: rule.note } : b));
  const ui = doc.ui?.map((u) => {
    if (u.type !== 'tool' || !u.toolUseId || !marked.has(u.toolUseId)) return u;
    const { rows: _rows, ...chip } = u;
    return { ...chip, summary: rule.note };
  });
  return { content, ...(ui ? { ui } : {}) };
}

/** Every chat of this athlete. Run after `forgetContexts`, never before. */
export async function clearContexts(c: Collections, userId: string, rule: ClearRule): Promise<void> {
  const threads = await c.threads.find({ userId }, { projection: { _id: 1 } }).toArray();
  for (const { _id } of threads as { _id: ObjectId }[]) {
    const messages = await c.messages.find({ threadId: _id, kind: { $ne: 'user' } }).toArray();
    const writes = messages.flatMap((m) => {
      const cleared = clearedMessage(m as never, rule);
      return cleared ? [{ updateOne: { filter: { _id: m._id }, update: { $set: cleared } } }] : [];
    });
    if (writes.length) await c.messages.bulkWrite(writes as never);
  }
  // A recap is the third block, and it was written from these messages.
  await c.threads.updateMany({ userId, 'systemSnapshot.2': { $exists: true } }, [{ $set: { systemSnapshot: { $slice: ['$systemSnapshot', 2] } } }]);
}

