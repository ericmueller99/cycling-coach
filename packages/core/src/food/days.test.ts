import type { FoodLogEntry } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { dayTotals } from './days';

const entry = (date: string, slot: string, kcal: number, over: Partial<FoodLogEntry> = {}): FoodLogEntry => ({
  id: `${date}-${slot}-${kcal}`,
  date,
  slot,
  kind: 'food',
  refId: 'f',
  name: 'Food',
  source: 'manual',
  quantity: 1,
  unit: 'serving',
  servings: 1,
  nutrients: { kcal, protein: kcal / 20, carbs: kcal / 10, fat: kcal / 50 },
  via: 'manual',
  createdAt: '2026-11-01T00:00:00Z',
  ...over,
});

describe('dayTotals', () => {
  it('sums each day and orders slots like the settings', () => {
    const t = dayTotals(
      [entry('2026-11-01', 'Dinner', 700), entry('2026-11-01', 'Breakfast', 400.4), entry('2026-11-01', 'Breakfast', 100), entry('2026-11-02', 'Snacks', 150)],
      ['Breakfast', 'Lunch', 'Dinner', 'Workout fuel', 'Snacks'],
    );
    expect(t.get('2026-11-01')).toEqual({
      eaten: { kcal: 1200, protein: 60, carbs: 120, fat: 24 },
      slots: [
        { name: 'Breakfast', kcal: 500 },
        { name: 'Dinner', kcal: 700 },
      ],
    });
    expect(t.get('2026-11-02')?.slots).toEqual([{ name: 'Snacks', kcal: 150 }]);
    expect(t.has('2026-11-03')).toBe(false);
  });

  it('puts slots the settings no longer have after the known ones', () => {
    const t = dayTotals([entry('2026-11-01', 'Second breakfast', 200), entry('2026-11-01', 'Afters', 100), entry('2026-11-01', 'Lunch', 500)], ['Breakfast', 'Lunch']);
    expect(t.get('2026-11-01')?.slots.map((s) => s.name)).toEqual(['Lunch', 'Afters', 'Second breakfast']);
  });
});
