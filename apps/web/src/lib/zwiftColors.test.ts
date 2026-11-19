import { describe, expect, it } from 'vitest';
import { penCategory, ZWIFT_CATEGORY_COLORS } from './zwiftColors';

describe('penCategory', () => {
  it('maps Zwift subgroup labels 1–5 to A–E', () => {
    expect([1, 2, 3, 4, 5].map(penCategory)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('has no category for labels outside 1–5', () => {
    expect([0, 6, -1].map(penCategory)).toEqual([undefined, undefined, undefined]);
  });
});

describe('ZWIFT_CATEGORY_COLORS', () => {
  it('uses Zwift colours: A+ black, A red, B green, C blue, D yellow', () => {
    expect(ZWIFT_CATEGORY_COLORS['A+'].bg).toBe('#0E1014');
    expect(ZWIFT_CATEGORY_COLORS.A.bg).toBe('#E03A32');
    expect(ZWIFT_CATEGORY_COLORS.D.fg).toBe('#0E1014');
    expect(ZWIFT_CATEGORY_COLORS.B.tint).toBe('#2F9E441F');
  });
});
