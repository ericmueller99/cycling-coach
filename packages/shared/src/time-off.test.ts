import { describe, expect, it } from 'vitest';
import { proposalChangeSchema } from './coach';
import { timeOffInputSchema, timeOffPatchSchema } from './time-off';

describe('time off schemas', () => {
  const entry = { kind: 'vacation', startDate: '2026-12-20', endDate: '2027-01-02' };

  it('takes a range, or a single day', () => {
    expect(timeOffInputSchema.parse(entry)).toEqual(entry);
    expect(timeOffInputSchema.safeParse({ ...entry, endDate: entry.startDate }).success).toBe(true);
  });

  it('refuses an end before the start, and anything over the longest entry', () => {
    expect(timeOffInputSchema.safeParse({ ...entry, endDate: '2026-12-19' }).success).toBe(false);
    expect(timeOffInputSchema.safeParse({ ...entry, startDate: '2026-01-01', endDate: '2027-01-01' }).success).toBe(true);
    expect(timeOffInputSchema.safeParse({ ...entry, startDate: '2026-01-01', endDate: '2027-01-02' }).success).toBe(false);
  });

  it('only knows vacation and sick', () => {
    expect(timeOffInputSchema.safeParse({ ...entry, kind: 'injured' }).success).toBe(false);
  });

  it('never injects anything into a patch', () => {
    expect(timeOffPatchSchema.parse({ endDate: '2027-01-05' })).toEqual({ endDate: '2027-01-05' });
    expect(timeOffPatchSchema.parse({ unset: ['note'] })).toEqual({ unset: ['note'] });
    expect(timeOffPatchSchema.safeParse({ unset: ['kind'] }).success).toBe(false);
  });

  it('stores time off rows and session rows side by side on a card', () => {
    expect(proposalChangeSchema.parse({ op: 'time_off_add', entry })).toEqual({ op: 'time_off_add', entry });
    expect(proposalChangeSchema.parse({ op: 'remove', eventId: 'e1' })).toEqual({ op: 'remove', eventId: 'e1' });
  });
});
