import { describe, expect, it } from 'vitest';
import { goalDateLabel } from './goals';

describe('goalDateLabel', () => {
  it('dates events and weight goals, with the year', () => {
    expect(goalDateLabel({ event: true, targetDate: '2027-06-12' })).toBe('Jun 12, 2027');
    expect(goalDateLabel({ measure: { kind: 'weight' }, targetDate: '2027-03-01' })).toBe('by Mar 1, 2027');
  });

  it('shows nothing for an open-ended goal, even with an old date stored', () => {
    expect(goalDateLabel({ measure: { kind: 'ftp' }, targetDate: '2027-03-01' })).toBeUndefined();
    expect(goalDateLabel({ event: true })).toBeUndefined();
  });
});
