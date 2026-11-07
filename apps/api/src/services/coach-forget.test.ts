import { describe, expect, it } from 'vitest';
import { clearedMessage } from './coach-forget';

const rule = { marker: 'other:', note: 'Removed' };

describe('clearing what only Claude saw', () => {
  it('leaves what the athlete typed', () => {
    expect(clearedMessage({ kind: 'user', content: [{ type: 'text', text: 'other:1' }] }, rule)).toBeNull();
  });

  it('empties a context message whole', () => {
    expect(clearedMessage({ kind: 'context', content: [{ type: 'text', text: 'Readiness: HRV 52 ms' }] }, rule)).toEqual({ content: [{ type: 'text', text: 'Removed' }] });
  });

  it('has nothing to do the second time', () => {
    expect(clearedMessage({ kind: 'context', content: [{ type: 'text', text: 'Removed' }] }, rule)).toBeNull();
  });

  it('drops thinking and keeps the coach’s words and tool calls', () => {
    const text = { type: 'text', text: 'Your HRV looks low' };
    const call = { type: 'tool_use', id: 't1', name: 'get_recent_activities', input: {} };
    const content = [{ type: 'thinking', thinking: 'HRV 52', signature: 's' }, { type: 'redacted_thinking', data: 'x' }, text, call];
    expect(clearedMessage({ kind: 'assistant', content }, rule)).toEqual({ content: [text, call] });
    expect(clearedMessage({ kind: 'assistant', content: [text] }, rule)).toBeNull();
  });

  it('empties tool results and keeps them paired with their calls', () => {
    const cleared = clearedMessage({ kind: 'tool_results', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'i1 ride' }] }, rule);
    expect(cleared?.content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'Removed' }]);
  });

  it('clears a chip only when its result held the source’s data', () => {
    const cleared = clearedMessage(
      {
        kind: 'tool_results',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'other:1 Morning ride' },
          { type: 'tool_result', tool_use_id: 't2', content: 'i1 Evening ride' },
        ],
        ui: [
          { type: 'tool', toolUseId: 't1', summary: 'Pulled 1 ride', rows: ['Morning ride'] },
          { type: 'tool', toolUseId: 't2', summary: 'Pulled 1 ride', rows: ['Evening ride'] },
          { type: 'proposal', toolUseId: 't1' },
        ],
      },
      rule,
    );
    expect(cleared?.ui).toEqual([
      { type: 'tool', toolUseId: 't1', summary: 'Removed' },
      { type: 'tool', toolUseId: 't2', summary: 'Pulled 1 ride', rows: ['Evening ride'] },
      { type: 'proposal', toolUseId: 't1' },
    ]);
  });
});
