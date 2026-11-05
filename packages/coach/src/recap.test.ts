import { describe, expect, it } from 'vitest';
import { renderCarryRecap, renderRecapSource, renderRestartRecap, renderTail, type OpenCards } from './recap';
import { TOOL_DEFINITIONS, TOOLS_HASH } from './tools';
import { hasOpenToolUse, type StoredMessage } from './transcript';

let n = 0;
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));
const msg = (kind: StoredMessage['kind'], content: unknown[], createdAt = at(3)): StoredMessage => ({ id: `m${n++}`, kind, content, createdAt });
const user = (text: string, day = 3) => msg('user', [{ type: 'text', text }], at(day));
const coach = (text: string, day = 3) => msg('assistant', [{ type: 'text', text }], at(day));
const NONE: OpenCards = { proposals: [], mealIdeas: [] };

describe('renderRecapSource', () => {
  it('keeps what was said, and leaves out thinking, context and tool output', () => {
    const text = renderRecapSource(
      [
        user('Plan my week'),
        msg('context', [{ type: 'text', text: 'Today is Tue. Calendar: ...' }]),
        msg('assistant', [
          { type: 'thinking', thinking: 'private', signature: 's' },
          { type: 'text', text: 'Here it is' },
          { type: 'tool_use', id: 't', name: 'propose_plan', input: { title: 'Build week', items: [{ title: 'a long payload' }] } },
        ]),
        msg('tool_results', [{ type: 'tool_result', tool_use_id: 't', content: 'Plan card shown (proposal 123)' }]),
      ],
      'Etc/UTC',
    );
    expect(text).toContain('Athlete: Plan my week');
    expect(text).toContain('Coach: Here it is');
    expect(text).toContain('(propose_plan: Build week)');
    for (const hidden of ['private', 'Calendar', 'a long payload', 'proposal 123']) expect(text).not.toContain(hidden);
  });

  it("dates the messages by the athlete's own day, so relative words can be resolved", () => {
    const text = renderRecapSource([msg('user', [{ type: 'text', text: 'late' }], at(3, 23)), user('next', 5)], 'Pacific/Auckland');
    expect(text).toContain('--- Wed Nov 4 ---');
    expect(text).toContain('--- Fri Nov 6 ---');
  });

  it('builds on the earlier recap', () => {
    const text = renderRecapSource([user('hello')], 'Etc/UTC', 'Agreed a rest day');
    expect(text.indexOf('Agreed a rest day')).toBeLessThan(text.indexOf('Athlete: hello'));
  });

  it('keeps the newest part of a very long chat', () => {
    const long = Array.from({ length: 3000 }, (_, i) => user(`message ${i} ${'x'.repeat(100)}`));
    const text = renderRecapSource(long, 'Etc/UTC');
    expect(text.length).toBeLessThanOrEqual(200_000);
    expect(text).toContain('message 2999');
    expect(text).not.toContain('message 0 ');
  });
});

describe('renderTail', () => {
  const chat = [user('one'), coach('reply one'), user('two'), coach('reply two'), user('three'), coach('reply three')];

  it('takes the last exchanges, in order', () => {
    expect(renderTail(chat, 2)).toBe('Athlete: two\nCoach: reply two\nAthlete: three\nCoach: reply three');
  });

  it('gives everything when there is less than that', () => {
    expect(renderTail(chat.slice(0, 2), 5)).toBe('Athlete: one\nCoach: reply one');
  });

  it('holds a reply together across a tool loop', () => {
    const looped = [user('go'), coach('Looking'), msg('tool_results', []), coach('Done')];
    expect(renderTail(looped, 1)).toBe('Athlete: go\nCoach: Looking\nCoach: Done');
  });

  it('cuts a very long message down', () => {
    expect(renderTail([coach('x'.repeat(5000))], 1).length).toBeLessThan(2100);
  });
});

describe('the recap blocks', () => {
  const today = '2026-11-04';
  const messages = [user('Should I do the VO2 session?'), coach('Yes, do it Thursday. Want me to add it?')];

  it('says the context message wins, so a lapsed note or an old date can not come back', () => {
    const block = renderRestartRecap({ summary: '- Knee was sore', messages, cards: NONE, today });
    expect(block).toContain('as of Wed Nov 4');
    expect(block).toContain('latest context message wins');
  });

  it('keeps the last exchange word for word, so "yes, do that" still works', () => {
    const block = renderRestartRecap({ summary: '- Knee was sore', messages, cards: NONE, today });
    expect(block).toContain('Coach: Yes, do it Thursday. Want me to add it?');
  });

  it('lists open cards with what to do with their ids', () => {
    const block = renderRestartRecap({
      summary: 'x',
      messages,
      cards: { proposals: [{ id: 'p1', kind: 'plan', title: 'Build week' }], mealIdeas: [{ id: 'i1', names: ['Pasta', 'Rice bowl'] }] },
      today,
    });
    expect(block).toContain('Proposal p1 (plan): "Build week"');
    expect(block).toContain('`replaces`');
    expect(block).toContain('Meal ideas i1: 0 Pasta, 1 Rice bowl');
    expect(block).toContain('ideas_id');
  });

  it('has no cards section when nothing is open', () => {
    expect(renderRestartRecap({ summary: 'x', messages, cards: NONE, today })).not.toContain('Cards still open');
  });

  it('keeps more of the chat when there is no summary', () => {
    const long = [user('a'), coach('b'), user('c'), coach('d'), user('e'), coach('f')];
    const withSummary = renderRestartRecap({ summary: 'x', messages: long, cards: NONE, today });
    const without = renderRestartRecap({ summary: null, messages: long, cards: NONE, today });
    expect(withSummary).not.toContain('Athlete: a');
    expect(without).toContain('Athlete: a');
  });

  it('tells a new chat to leave the old one alone unless it matters', () => {
    const block = renderCarryRecap({ summary: '- Busy week', messages, lastDate: '2026-11-03', today });
    expect(block).toContain('previous chat, from Tue Nov 3');
    expect(block).toContain("don't bring it up otherwise");
    expect(block).toContain('- Busy week');
    expect(block).not.toContain('word for word');
  });

  it('falls back to the last exchanges for a new chat too', () => {
    expect(renderCarryRecap({ summary: null, messages, lastDate: '2026-11-03', today })).toContain('Athlete: Should I do the VO2 session?');
  });
});

describe('hasOpenToolUse', () => {
  const call = (id: string) => msg('assistant', [{ type: 'tool_use', id, name: 'x', input: {} }]);
  const result = (id: string) => msg('tool_results', [{ type: 'tool_result', tool_use_id: id, content: 'ok' }]);

  it('is false when every call has its result', () => {
    expect(hasOpenToolUse([user('a'), call('1'), result('1'), coach('b')])).toBe(false);
  });

  it('finds one with no result, even with messages after it', () => {
    expect(hasOpenToolUse([call('1'), result('1'), call('2')])).toBe(true);
    expect(hasOpenToolUse([call('2'), user('hello?'), msg('context', [{ type: 'text', text: 'x' }])])).toBe(true);
  });
});

describe('TOOLS_HASH', () => {
  it('is a stable short string for this exact tool list', () => {
    expect(TOOLS_HASH).toMatch(/^[0-9a-f]{1,8}$/);
    expect(TOOL_DEFINITIONS.length).toBeGreaterThan(0);
  });
});
