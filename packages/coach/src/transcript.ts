import type { UiBlock, UiMessage } from '@cycling-coach/shared';

/** The subset of a stored message the UI mapping needs (matches packages/db MessageDoc). */
export interface StoredMessage {
  id: string;
  kind: 'user' | 'context' | 'tool_results' | 'assistant';
  content: unknown[];
  ui?: Exclude<UiBlock, { type: 'text' }>[];
  createdAt: Date;
  model?: string | undefined;
}

function textOf(content: unknown[]): string[] {
  const out: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) out.push(text);
    }
  }
  return out;
}

/** A tool call with no result, which the API rejects. Only a crash between the two leaves one behind. */
export function hasOpenToolUse(messages: Pick<StoredMessage, 'kind' | 'content'>[]): boolean {
  const open = new Set<unknown>();
  for (const m of messages) {
    for (const block of m.content as { type?: string; id?: unknown; tool_use_id?: unknown }[]) {
      if (m.kind === 'assistant' && block?.type === 'tool_use') open.add(block.id);
      if (m.kind === 'tool_results' && block?.type === 'tool_result') open.delete(block.tool_use_id);
    }
  }
  return open.size > 0;
}

/**
 * Derive chat bubbles from the verbatim transcript. One assistant bubble spans the whole tool loop
 * (text, chips, cards, more text) until the next user message — that's how the chat shows it.
 * Context messages are for the model only.
 */
export function toUiMessages(messages: StoredMessage[]): UiMessage[] {
  const out: UiMessage[] = [];
  const current = (createdAt: Date, id: string) => {
    const last = out[out.length - 1];
    if (last && last.role === 'assistant') return last;
    const bubble: UiMessage = { id, role: 'assistant', blocks: [], createdAt: createdAt.toISOString() };
    out.push(bubble);
    return bubble;
  };

  for (const m of messages) {
    if (m.kind === 'user') {
      out.push({
        id: m.id,
        role: 'user',
        blocks: textOf(m.content).map((text) => ({ type: 'text', text })),
        createdAt: m.createdAt.toISOString(),
      });
    } else if (m.kind === 'assistant') {
      const texts = textOf(m.content);
      if (texts.length) current(m.createdAt, m.id).blocks.push(...texts.map((text) => ({ type: 'text' as const, text })));
      // One bubble can span both models; it's labelled with the one that wrote last.
      const bubble = out[out.length - 1];
      if (m.model && bubble?.role === 'assistant') bubble.model = m.model;
    } else if (m.kind === 'tool_results' && m.ui?.length) {
      current(m.createdAt, m.id).blocks.push(...m.ui);
    }
  }
  return out;
}
