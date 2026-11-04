import type { StapleDetail } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { defaultPortionIndex, foodFromStaple, measureFromServingLabel, parsePortionLabel } from './reference';
import { computePortion } from './portions';

describe('parsePortionLabel', () => {
  it('reads counted portions', () => {
    expect(parsePortionLabel('1 large egg')).toEqual({ quantity: 1, unit: 'large egg', isMass: false });
    expect(parsePortionLabel('2 large eggs')).toEqual({ quantity: 2, unit: 'large eggs', isMass: false });
    expect(parsePortionLabel('1 medium (18cm to 20cm long)')).toEqual({ quantity: 1, unit: 'medium', isMass: false });
  });
  it('reads volumes and weights', () => {
    expect(parsePortionLabel('125 ml')).toEqual({ quantity: 125, unit: 'ml', isMass: false });
    expect(parsePortionLabel('50 g')).toEqual({ quantity: 50, unit: 'g', isMass: true });
    expect(parsePortionLabel('1 cup')).toEqual({ quantity: 1, unit: 'cup', isMass: false });
  });
  it('turns a qualified volume into its own cup unit', () => {
    expect(parsePortionLabel('250 ml slices')).toEqual({ quantity: 1, unit: 'cup slices', isMass: false });
    expect(parsePortionLabel('100 ml mashed')).toEqual({ quantity: 0.4, unit: 'cup mashed', isMass: false });
    expect(parsePortionLabel('1 cup chopped')).toEqual({ quantity: 1, unit: 'cup chopped', isMass: false });
  });
  it('handles fractions and rejects labels without a quantity', () => {
    expect(parsePortionLabel('1/2 cup')).toMatchObject({ quantity: 0.5, unit: 'cup' });
    expect(parsePortionLabel('total refuse')).toBeNull();
  });
});

const egg: StapleDetail = {
  source: 'cnf',
  ref: '125',
  name: 'Egg, chicken, whole, fresh or frozen, raw',
  kcalPer100g: 152,
  per100g: { kcal: 152, fat: 10, carbs: 1, protein: 12.4 },
  portions: [
    { label: '1 large egg', grams: 52.61 },
    { label: '1 small egg', grams: 39.13 },
    { label: '125 ml', grams: 128.381 },
    { label: '250 ml', grams: 256.762 },
    { label: '50 g', grams: 50 },
    { label: '2 large eggs', grams: 105.22 },
  ],
};

describe('measureFromServingLabel', () => {
  it('reads a count with no weight', () => {
    expect(measureFromServingLabel('1 sandwich')).toEqual({ unit: 'sandwich', amount: 1 });
    expect(measureFromServingLabel('2 cookies')).toEqual({ unit: 'cookies', amount: 2 });
    expect(measureFromServingLabel('Per 1 sandwich')).toEqual({ unit: 'sandwich', amount: 1 });
  });
  it('reads a plain weight or volume', () => {
    expect(measureFromServingLabel('175 g')).toEqual({ unit: 'g', amount: 175 });
    expect(measureFromServingLabel('3/4 cup (175 g)')).toEqual({ unit: 'cup', amount: 0.75 });
  });
  it('gives up on no number, or a unit too long to store', () => {
    expect(measureFromServingLabel('grande')).toBeNull();
    expect(measureFromServingLabel('')).toBeNull();
    expect(measureFromServingLabel('1 sandwich on a toasted everything croissant')).toBeNull();
  });
});

describe('foodFromStaple', () => {
  it('keeps 100 g as the reference and one measure per unit', () => {
    const f = foodFromStaple(egg, { name: 'Egg, large', defaultIndex: 0 });
    expect(f.measures.map((m) => m.unit)).toEqual(['g', 'large egg', 'small egg', 'ml']);
    expect(f.defaultPortion).toEqual({ quantity: 1, unit: 'large egg' });
    expect(f.source).toBe('cnf');
    expect(f.sourceRef).toBe('125');
    expect(f.name).toBe('Egg, large');
  });
  it('a large egg prices at its gram weight; 2 eggs works through the plural', () => {
    const f = foodFromStaple(egg, { name: 'Egg', defaultIndex: 0 });
    expect(computePortion(f, 1, 'large egg')!.nutrients.kcal).toBeCloseTo(80, 0);
    expect(computePortion(f, 2, 'large eggs')!.grams).toBeCloseTo(105.2, 1);
    expect(computePortion(f, 125, 'ml')!.grams).toBeCloseTo(128.4, 1);
  });
  it('defaults to 100 g when asked', () => {
    expect(foodFromStaple(egg, { name: 'Egg', defaultIndex: -1 }).defaultPortion).toEqual({ quantity: 100, unit: 'g' });
  });
  it('picks an everyday default portion', () => {
    expect(defaultPortionIndex(egg.portions)).toBe(0);
    expect(defaultPortionIndex([{ label: '250 ml slices' }, { label: '1 small (15cm)' }, { label: '1 medium (18cm)' }])).toBe(2);
    expect(defaultPortionIndex([{ label: '100 ml' }])).toBe(-1);
  });
});
