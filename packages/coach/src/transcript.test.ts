import { describe, expect, it } from 'vitest';
import { toUiMessages, type StoredMessage } from './transcript';

const at = new Date('2026-11-14T10:00:00Z');
const msg = (id: string, m: Omit<StoredMessage, 'id' | 'createdAt'>): StoredMessage => ({ id, createdAt: at, ...m });
const text = (t: string) => [{ type: 'text', text: t }];

describe('toUiMessages', () => {
  it('shows a handoff in one bubble: the kept words, the marker, then the build (DECISIONS #110)', () => {
    const marker = { type: 'handoff' as const, model: 'claude-opus-5-5', tool: 'propose_plan' };
    const ui = toUiMessages([
      msg('u', { kind: 'user', content: text('Plan my week') }),
      msg('c', { kind: 'context', content: text('Today is Friday.') }),
      msg('a1', { kind: 'assistant', content: text('Good call, with Saturday in mind.'), model: 'claude-sonnet-5-5' }),
      msg('n', { kind: 'context', content: text('The build model takes over this turn here.') }),
      msg('a2', { kind: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, ...text('Here is the week.')], ui: [marker], model: 'claude-opus-5-5' }),
    ]);
    expect(ui).toHaveLength(2);
    expect(ui[1]!.blocks).toEqual([{ type: 'text', text: 'Good call, with Saturday in mind.' }, marker, { type: 'text', text: 'Here is the week.' }]);
    expect(ui[1]!.model).toBe('claude-opus-5-5');
  });

  it('starts the bubble with the marker when the chat model wrote nothing first', () => {
    const marker = { type: 'handoff' as const, model: 'claude-opus-5-5', tool: 'create_workout' };
    const ui = toUiMessages([
      msg('u', { kind: 'user', content: text('Build me a workout') }),
      msg('a', { kind: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'create_workout', input: {} }], ui: [marker], model: 'claude-opus-5-5' }),
    ]);
    expect(ui[1]!.blocks).toEqual([marker]);
  });
});
