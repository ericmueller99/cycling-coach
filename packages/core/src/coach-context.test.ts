import { describe, expect, it } from 'vitest';
import { carriesTail, carrySince, HARD_TOKENS, LAND_IDLE_MINUTES, landsOnNewChat, RESTART_TOKENS, restartReason, returnsToNewChat, STALE_DAYS, TURN_IN_FLIGHT_MS, type ContextState } from './coach-context';

const NOW = new Date('2026-11-04T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const state = (over: Partial<ContextState> = {}): ContextState => ({
  tokens: 1_000,
  lastMessageAt: ago(MIN),
  toolsHash: 'a',
  currentToolsHash: 'a',
  tail: { finished: true, at: ago(MIN) },
  openToolUse: false,
  now: NOW,
  ...over,
});

describe('restartReason', () => {
  it('restarts a forgotten context, even under a turn that may be running', () => {
    expect(restartReason(state({ forget: true }))).toBe('reset');
    expect(restartReason(state({ forget: true, tail: { finished: false, at: NOW } }))).toBe('reset');
    expect(restartReason(state({ forget: true, tail: null }))).toBeNull();
  });
  it('leaves a small, recent chat alone', () => {
    expect(restartReason(state())).toBeNull();
  });

  it('has nothing to restart on an empty chat, whatever else is true', () => {
    expect(restartReason(state({ tail: null, toolsHash: undefined, lastMessageAt: ago(60 * DAY) }))).toBeNull();
  });

  describe('size', () => {
    it('restarts a long chat on a return, once the cache has gone', () => {
      expect(restartReason(state({ tokens: RESTART_TOKENS, lastMessageAt: ago(5 * MIN) }))).toBe('size');
    });

    it('leaves a long chat alone mid-conversation, where reads are cheap', () => {
      expect(restartReason(state({ tokens: RESTART_TOKENS, lastMessageAt: ago(4 * MIN) }))).toBeNull();
    });

    it('leaves a shorter chat alone on a return', () => {
      expect(restartReason(state({ tokens: RESTART_TOKENS - 1, lastMessageAt: ago(60 * MIN) }))).toBeNull();
    });

    it('restarts at the ceiling even mid-conversation', () => {
      expect(restartReason(state({ tokens: HARD_TOKENS }))).toBe('size');
    });
  });

  describe('age', () => {
    it('restarts a chat left for the cut-off, however small', () => {
      expect(restartReason(state({ lastMessageAt: ago(STALE_DAYS * DAY) }))).toBe('age');
    });

    it('not a day before', () => {
      expect(restartReason(state({ lastMessageAt: ago((STALE_DAYS - 1) * DAY) }))).toBeNull();
    });
  });

  describe('tools', () => {
    it('restarts when the tool definitions changed', () => {
      expect(restartReason(state({ toolsHash: 'old' }))).toBe('tools');
    });

    it('restarts a chat with no record of its tools, once', () => {
      expect(restartReason(state({ toolsHash: undefined }))).toBe('tools');
    });

    it('wins over size, so the reason says what has to be fixed', () => {
      expect(restartReason(state({ toolsHash: 'old', tokens: HARD_TOKENS }))).toBe('tools');
    });
  });

  describe('a turn that may still be running', () => {
    const running = { tail: { finished: false, at: ago(2 * MIN) } };

    it('leaves it alone, even at the ceiling, with new tools, or looking idle', () => {
      expect(restartReason(state({ ...running, tokens: HARD_TOKENS }))).toBeNull();
      expect(restartReason(state({ ...running, toolsHash: 'old' }))).toBeNull();
      expect(restartReason(state({ ...running, tokens: RESTART_TOKENS, lastMessageAt: ago(6 * MIN) }))).toBeNull();
    });

    it('leaves an open tool call alone while it runs', () => {
      expect(restartReason(state({ ...running, openToolUse: true }))).toBeNull();
    });

    it('frees a chat stuck on a tool call with no result, once the turn is clearly dead', () => {
      expect(restartReason(state({ tail: { finished: false, at: ago(21 * MIN) }, openToolUse: true }))).toBe('repair');
    });

    it('treats a dead turn like any other on the rest of the rules', () => {
      const dead = { tail: { finished: false, at: ago(21 * MIN) } };
      expect(restartReason(state(dead))).toBeNull();
      expect(restartReason(state({ ...dead, tokens: RESTART_TOKENS, lastMessageAt: ago(21 * MIN) }))).toBe('size');
    });
  });
});

describe('landsOnNewChat', () => {
  it('reopens a chat from the last 30 minutes and not one older', () => {
    expect(landsOnNewChat(ago(30 * MIN - 1), NOW)).toBe(false);
    expect(landsOnNewChat(ago(30 * MIN), NOW)).toBe(true);
  });

  it('stays longer than a turn can run, so a quiet chat never has one going', () => {
    expect(LAND_IDLE_MINUTES * MIN).toBeGreaterThan(TURN_IN_FLIGHT_MS);
  });
});

describe('returnsToNewChat', () => {
  const left = ago(40 * MIN);
  const last = ago(45 * MIN);
  const away = { hiddenAt: left, latestAt: last };

  it('starts a new chat after half an hour away with nothing new', () => {
    expect(returnsToNewChat(away, last, NOW)).toBe(true);
    expect(returnsToNewChat({ ...away, hiddenAt: ago(30 * MIN) }, last, NOW)).toBe(true);
  });

  it('stays after a short break', () => {
    expect(returnsToNewChat({ ...away, hiddenAt: ago(30 * MIN - 1) }, last, NOW)).toBe(false);
  });

  it('stays when a reply landed while they were away, which is what they came back for', () => {
    expect(returnsToNewChat(away, ago(10 * MIN), NOW)).toBe(false);
  });

  it('stays on an old chat just reopened, however long ago it was last used', () => {
    expect(returnsToNewChat({ hiddenAt: ago(2 * MIN), latestAt: ago(60 * 24 * MIN) }, ago(60 * 24 * MIN), NOW)).toBe(false);
  });
});

describe('carriesTail', () => {
  it('keeps the last words of a chat from the last 12 hours only', () => {
    expect(carriesTail(ago(12 * 60 * MIN - 1), NOW)).toBe(true);
    expect(carriesTail(ago(12 * 60 * MIN), NOW)).toBe(false);
  });
});

describe('carrySince', () => {
  it('reaches back a week', () => {
    expect(carrySince(NOW).toISOString()).toBe('2026-10-28T12:00:00.000Z');
  });
});
