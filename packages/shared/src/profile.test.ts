import { describe, expect, it } from 'vitest';
import { goalPatchSchema, goalProposalSchema, WEIGHT_PACES, weightPaceSchema } from './index';

describe('weightPaceSchema', () => {
  it('takes every listed pace', () => {
    for (const unit of ['lb', 'kg'] as const) {
      for (const per of ['week', 'month'] as const) {
        for (const amount of WEIGHT_PACES[unit][per]) expect(weightPaceSchema.safeParse({ amount, unit, per }).success).toBe(true);
      }
    }
  });

  it('rejects anything else', () => {
    expect(weightPaceSchema.safeParse({ amount: 3, unit: 'lb', per: 'week' }).success).toBe(false);
    expect(weightPaceSchema.safeParse({ amount: 0.6, unit: 'kg', per: 'week' }).success).toBe(false);
    expect(weightPaceSchema.safeParse({ amount: 10, unit: 'lb', per: 'month' }).success).toBe(false);
  });

  it('is checked on goal patches and coach proposals', () => {
    expect(goalPatchSchema.safeParse({ pace: { amount: 5, unit: 'lb', per: 'week' } }).success).toBe(false);
    expect(goalPatchSchema.safeParse({ unset: ['pace'] }).success).toBe(true);
    expect(goalProposalSchema.safeParse({ horizon: 'long', title: 'Race weight', measure: { kind: 'weight' }, target: 72, pace: { amount: 1, unit: 'lb', per: 'week' } }).success).toBe(true);
  });
});
