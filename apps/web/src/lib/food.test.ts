import { describe, expect, it } from 'vitest';
import { caloriesDraft, entryLine, parseCalories } from './food';

const entry = { kind: 'calories' as const, quantity: 1, unit: 'serving', nutrients: { kcal: 600, protein: 0, carbs: 0, fat: 0 } };

describe('parseCalories', () => {
  it('needs kcal and leaves blanks out', () => {
    expect(parseCalories({ protein: '30' })).toBeNull();
    expect(parseCalories({ kcal: '600', protein: ' ', fat: '' })).toEqual({ kcal: 600 });
    expect(parseCalories({ kcal: '600', protein: '30.5' })).toEqual({ kcal: 600, protein: 30.5 });
  });

  it('refuses anything that isn\'t a number', () => {
    expect(parseCalories({ kcal: 'lots' })).toBeNull();
    expect(parseCalories({ kcal: '600', fat: '-1' })).toBeNull();
  });
});

describe('caloriesDraft', () => {
  it('brings a blank macro back blank, but keeps kcal at 0', () => {
    expect(caloriesDraft({ kcal: 0, protein: 0, carbs: 12, fat: 0 })).toEqual({ kcal: '0', carbs: '12' });
  });
});

describe('entryLine', () => {
  it('doesn\'t show a blank macro as a measured zero', () => {
    expect(entryLine(entry)).toBe('kcal only');
  });

  it('shows the macros a calories entry does have, and no portion', () => {
    expect(entryLine({ ...entry, nutrients: { ...entry.nutrients, protein: 30 } })).toBe('P 30 · C 0 · F 0');
  });

  it('leads with the range on an estimate', () => {
    const estimate = { low: 1180, high: 1650, items: [], images: [] };
    expect(entryLine({ ...entry, nutrients: { kcal: 1400, protein: 70, carbs: 95, fat: 70 }, estimate })).toBe('likely 1,180–1,650 · P 70 · C 95 · F 70');
  });
});
