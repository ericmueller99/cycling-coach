import { describe, expect, it } from 'vitest';
import {
  amountPerServing,
  canonicalUnit,
  duplicateMeasureUnits,
  formatPortion,
  formatQuantity,
  portionGrams,
  toServings,
  unitKey,
  unitsFor,
  withMeasure,
} from './units';

const spaghetti = { measures: [{ unit: 'g', amount: 85 }] };
const crackers = { measures: [{ unit: 'g', amount: 85 }, { unit: 'piece', amount: 2 }] };
const yogurt = { measures: [{ unit: 'g', amount: 175 }, { unit: 'cup', amount: 0.75 }] };
const mocha = { measures: [{ unit: 'grande', amount: 1 }] };

describe('canonicalUnit / unitKey', () => {
  it('collapses standard spellings', () => {
    expect(canonicalUnit('Grams')).toBe('g');
    expect(canonicalUnit(' tablespoons ')).toBe('tbsp');
    expect(canonicalUnit('fl oz')).toBe('fl_oz');
    expect(canonicalUnit('mL')).toBe('ml');
    expect(canonicalUnit('Bagel')).toBe('bagel');
  });
  it('matches a plural label unit to its singular', () => {
    expect(unitKey('slices')).toBe('slice');
    expect(unitKey('glass')).toBe('glass');
    expect(unitKey('cups')).toBe('cup');
  });
});

describe('toServings — the app does the maths', () => {
  it('100 g of an 85 g label is 1.18 servings', () => {
    expect(toServings(spaghetti, 100, 'g')).toBeCloseTo(1.1765, 3);
  });
  it('converts within the mass family', () => {
    expect(toServings(spaghetti, 3, 'oz')).toBeCloseTo((3 * 28.349523125) / 85, 6);
    expect(toServings(spaghetti, 0.17, 'kg')).toBeCloseTo(2, 6);
  });
  it('a label unit maps through its own measure: 1 piece of "2 pieces (85 g)" is half a serving', () => {
    expect(toServings(crackers, 1, 'piece')).toBe(0.5);
    expect(toServings(crackers, 3, 'pieces')).toBe(1.5);
    expect(portionGrams(crackers, 1, 'piece')).toBeCloseTo(42.5, 6);
  });
  it('the food’s own cup measure wins over the 250 ml constant, and other volumes follow from it', () => {
    expect(toServings(yogurt, 1, 'cup')).toBeCloseTo(1 / 0.75, 6);
    expect(amountPerServing(yogurt, 'g')).toBe(175);
    // 3/4 cup = 187.5 ml (metric cup) → 1 tbsp = 15/187.5 servings
    expect(toServings(yogurt, 1, 'tbsp')).toBeCloseTo(15 / 187.5, 6);
    expect(portionGrams(yogurt, 1, 'cup')).toBeCloseTo(233.33, 1);
  });
  it('serving always works; unknown units do not', () => {
    expect(toServings(mocha, 1, 'serving')).toBe(1);
    expect(toServings(mocha, 2, 'grande')).toBe(2);
    expect(toServings(mocha, 100, 'g')).toBeNull();
    expect(toServings(spaghetti, 1, 'cup')).toBeNull();
  });
});

describe('withMeasure — "1 cup = 120 g"', () => {
  it('stores the new measure relative to the reference serving', () => {
    const measures = withMeasure(spaghetti, { quantity: 1, unit: 'cup' }, { quantity: 120, unit: 'g' })!;
    const food = { measures };
    expect(amountPerServing(food, 'cup')).toBeCloseTo(85 / 120, 4);
    expect(portionGrams(food, 1, 'cup')).toBeCloseTo(120, 1);
  });
  it('replaces an existing measure of the same unit', () => {
    const measures = withMeasure(yogurt, { quantity: 1, unit: 'cups' }, { quantity: 250, unit: 'g' })!;
    expect(measures.filter((m) => unitKey(m.unit) === 'cup')).toHaveLength(1);
    expect(portionGrams({ measures }, 1, 'cup')).toBeCloseTo(250, 1);
  });
  it('refuses when the known side does not fit the food', () => {
    expect(withMeasure(mocha, { quantity: 1, unit: 'cup' }, { quantity: 120, unit: 'g' })).toBeNull();
  });
});

describe('unitsFor', () => {
  it('lists the default first, own measures, serving, then the family', () => {
    expect(unitsFor({ ...crackers, defaultPortion: { quantity: 2, unit: 'piece' } })).toEqual(['piece', 'g', 'serving', 'oz']);
    expect(unitsFor(yogurt)).toEqual(['g', 'cup', 'serving', 'oz', 'ml', 'tbsp', 'tsp']);
    expect(unitsFor(mocha)).toEqual(['grande', 'serving']);
  });
});

describe('formatting', () => {
  it('uses fractions for common portions', () => {
    expect(formatQuantity(1.5)).toBe('1½');
    expect(formatQuantity(0.25)).toBe('¼');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(1.137)).toBe('1.14');
  });
  it('pluralises', () => {
    expect(formatPortion(2, 'cup')).toBe('2 cups');
    expect(formatPortion(1.5, 'bagel')).toBe('1½ bagels');
    expect(formatPortion(150, 'g')).toBe('150 g');
    expect(formatPortion(1, 'fl_oz')).toBe('1 fl oz');
  });
});

it('flags duplicate measures', () => {
  expect(duplicateMeasureUnits([{ unit: 'g', amount: 1 }, { unit: 'grams', amount: 2 }])).toEqual(['grams']);
  expect(duplicateMeasureUnits(crackers.measures)).toEqual([]);
});
