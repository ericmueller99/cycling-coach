import { describe, expect, it } from 'vitest';
import { revealRate, settleMarkdown, TextPacer, wordCut } from './textPacer';

function pacer() {
  const log: string[] = [];
  const p = new TextPacer<string>({ text: (t) => log.push(`text:${t}`), event: (e) => log.push(`event:${e}`) });
  const shown = () => log.filter((l) => l.startsWith('text:')).map((l) => l.slice(5)).join('');
  return { p, log, shown };
}

describe('revealRate', () => {
  it('stays readable with little waiting, and catches up with a lot', () => {
    expect(revealRate(1)).toBe(40);
    expect(revealRate(120)).toBe(100);
    expect(revealRate(100_000)).toBe(400);
  });
});

describe('wordCut', () => {
  it('finishes the word the budget lands in', () => {
    expect('easy spin today'.slice(0, wordCut('easy spin today', 2))).toBe('easy ');
    expect('easy spin today'.slice(0, wordCut('easy spin today', 7))).toBe('easy spin ');
  });
  it('cuts on the space when the budget ends on one', () => {
    expect('easy spin'.slice(0, wordCut('easy spin', 5))).toBe('easy ');
  });
  it('lets the rest out when there is no space left', () => {
    expect(wordCut('recovery', 2)).toBe(8);
    expect(wordCut('short', 50)).toBe(5);
  });
});

describe('TextPacer', () => {
  it('lets text out over time, not all at once', () => {
    const { p, shown } = pacer();
    const text = 'word '.repeat(100);
    p.pushText(text);
    p.tick(33);
    expect(shown().length).toBeGreaterThan(0);
    expect(shown().length).toBeLessThan(40);
    for (let i = 0; i < 200 && !p.idle; i++) p.tick(33);
    expect(shown()).toBe(text);
  });

  it('never loses or reorders text across uneven ticks', () => {
    const { p, shown } = pacer();
    p.pushText('one two ');
    p.tick(5);
    p.pushText('three four');
    for (let i = 0; i < 100 && !p.idle; i++) p.tick(i % 2 ? 1 : 50);
    expect(shown()).toBe('one two three four');
  });

  it('applies an event at once when no text is ahead of it', () => {
    const { p, log } = pacer();
    p.pushEvent('thinking');
    expect(log).toEqual(['event:thinking']);
    expect(p.idle).toBe(true);
  });

  it('holds a card behind the text before it', () => {
    const { p, log } = pacer();
    p.pushText('Here is your week. ');
    p.pushEvent('card');
    p.pushText('And why.');
    expect(log).toEqual([]);
    for (let i = 0; i < 100 && !p.idle; i++) p.tick(33);
    const card = log.indexOf('event:card');
    expect(log.slice(0, card).join('')).toContain('week.');
    expect(log.slice(0, card).join('')).not.toContain('why');
    expect(log.slice(card).join('')).toContain('why');
  });

  it('drops waiting text when its model call is dropped, and keeps the events', () => {
    const { p, log, shown } = pacer();
    p.pushText('Let me look at that. ');
    p.pushEvent('chip');
    p.pushText('Actually');
    p.dropText();
    p.pushEvent('discard');
    expect(shown()).toBe('');
    expect(log).toEqual(['event:chip', 'event:discard']);
    expect(p.idle).toBe(true);
  });

  it('flushes everything in order on Stop', () => {
    const { p, log } = pacer();
    p.pushText('First. ');
    p.pushEvent('card');
    p.pushText('Second.');
    p.flush();
    expect(log).toEqual(['text:First. ', 'event:card', 'text:Second.']);
    expect(p.idle).toBe(true);
  });

  it('gets a long backlog out within the finishing time once the stream ends', () => {
    const { p, shown } = pacer();
    const text = 'word '.repeat(2000);
    p.pushText(text);
    p.finish();
    let elapsed = 0;
    for (; !p.idle && elapsed < 5000; elapsed += 33) p.tick(33);
    expect(shown()).toBe(text);
    expect(elapsed).toBeLessThanOrEqual(2100);
  });
});

describe('settleMarkdown', () => {
  it('closes bold that is still open', () => {
    expect(settleMarkdown('**Tuesday: ea')).toBe('**Tuesday: ea**');
    expect(settleMarkdown('**Tuesday: ')).toBe('**Tuesday:**');
  });
  it('holds back a marker with nothing after it', () => {
    expect(settleMarkdown('Key point **')).toBe('Key point ');
    expect(settleMarkdown('Key point *')).toBe('Key point ');
    expect(settleMarkdown('**Tuesday*')).toBe('**Tuesday**');
  });
  it('closes open inline code', () => {
    expect(settleMarkdown('use `fo')).toBe('use `fo`');
  });
  it('leaves finished text alone', () => {
    const text = '**Bold** and `code` and a list\n\n- one\n- two\n';
    expect(settleMarkdown(text)).toBe(text);
  });
});
