import { expect, it } from 'vitest';
import { timeOffPatchUpdate } from './time-off';

const now = new Date('2026-11-02T12:00:00Z');

it('sets what a patch sets and clears a removed note', () => {
  expect(timeOffPatchUpdate({ endDate: '2026-11-09' }, now)).toEqual({ $set: { endDate: '2026-11-09', updatedAt: now } });
  expect(timeOffPatchUpdate({ endDate: '2026-11-09', unset: ['note'] }, now)).toEqual({ $set: { endDate: '2026-11-09', updatedAt: now }, $unset: { note: '' } });
});

it('keeps a note that is both set and cleared', () => {
  expect(timeOffPatchUpdate({ note: 'Head cold', unset: ['note'] }, now)).toEqual({ $set: { note: 'Head cold', updatedAt: now } });
});
