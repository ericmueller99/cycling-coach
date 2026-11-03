import { describe, expect, it } from 'vitest';
import { isShareToken, shareUrl } from './recipe-share';

describe('share links', () => {
  it('builds the /r/ address from APP_URL with or without a trailing slash', () => {
    expect(shareUrl('https://coach.example.com', 'abc')).toBe('https://coach.example.com/r/abc');
    expect(shareUrl('http://localhost:5173/', 'abc')).toBe('http://localhost:5173/r/abc');
  });
  it('only looks up tokens of the right shape', () => {
    expect(isShareToken('a'.repeat(32))).toBe(true);
    expect(isShareToken('A_b-'.repeat(8))).toBe(true);
    expect(isShareToken('a'.repeat(31))).toBe(false);
    expect(isShareToken('{"$ne":null}'.padEnd(32, 'x'))).toBe(false);
  });
});
