import { describe, expect, it } from 'vitest';
import { applyNutrientChanges } from './adjust';

const mocha = { kcal: 370, fat: 15, satFat: 10, transFat: 0.5, sugars: 35 };

describe('applyNutrientChanges', () => {
  it('moves each nutrient by its delta and reports what changed', () => {
    const r = applyNutrientChanges(mocha, [
      { nutrient: 'kcal', delta: -80 },
      { nutrient: 'fat', delta: -7.5 },
    ]);
    expect(r.nutrients).toEqual({ ...mocha, kcal: 290, fat: 7.5 });
    expect(r.applied).toEqual([
      { nutrient: 'kcal', from: 370, to: 290 },
      { nutrient: 'fat', from: 15, to: 7.5 },
    ]);
  });

  it('works from the values as they stand, so an edit made after the proposal is kept', () => {
    expect(applyNutrientChanges({ ...mocha, kcal: 400 }, [{ nutrient: 'kcal', delta: -80 }]).nutrients.kcal).toBe(320);
  });

  it('never goes below zero', () => {
    expect(applyNutrientChanges(mocha, [{ nutrient: 'transFat', delta: -2 }]).nutrients.transFat).toBe(0);
  });

  it('leaves a nutrient with no value alone', () => {
    const r = applyNutrientChanges(mocha, [{ nutrient: 'potassiumMg', delta: -30 }]);
    expect(r.nutrients).toEqual(mocha);
    expect(r.applied).toEqual([]);
  });

  it('rounds calories to whole numbers and the rest to one place', () => {
    const r = applyNutrientChanges(mocha, [
      { nutrient: 'kcal', delta: -80.4 },
      { nutrient: 'sugars', delta: -1.26 },
    ]);
    expect(r.nutrients).toMatchObject({ kcal: 290, sugars: 33.7 });
  });

  it('adds up repeats, and drops a change that nets out', () => {
    const r = applyNutrientChanges(mocha, [
      { nutrient: 'kcal', delta: -80 },
      { nutrient: 'kcal', delta: -20 },
      { nutrient: 'fat', delta: 2 },
      { nutrient: 'fat', delta: -2 },
    ]);
    expect(r.applied).toEqual([{ nutrient: 'kcal', from: 370, to: 270 }]);
  });
});
