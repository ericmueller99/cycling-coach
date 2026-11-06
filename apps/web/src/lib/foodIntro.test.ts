import { describe, expect, it } from 'vitest';
import { shouldShowFoodIntro } from './foodIntro';

const logged = { 'food:1': { count: 1, lastDate: '2026-11-01', slots: {} } } as never;

describe('shouldShowFoodIntro', () => {
  it('shows for someone who has never logged', () => {
    expect(shouldShowFoodIntro({ introSeen: false, usage: {} })).toBe(true);
  });

  it('never shows twice', () => {
    expect(shouldShowFoodIntro({ introSeen: true, usage: {} })).toBe(false);
  });

  it("doesn't show for someone who already logs", () => {
    expect(shouldShowFoodIntro({ introSeen: false, usage: logged })).toBe(false);
  });
});
