import { describe, expect, it } from 'vitest';
import { eventPatchUpdate } from './calendar';

describe('eventPatchUpdate', () => {
  const now = new Date('2026-11-02T12:00:00Z');

  it('sets fields and never writes the unset list itself', () => {
    expect(eventPatchUpdate({ title: 'Race', startTime: '18:30' }, now)).toEqual({ $set: { title: 'Race', startTime: '18:30', updatedAt: now } });
  });

  it('clears what an edit emptied', () => {
    expect(eventPatchUpdate({ title: 'Race', unset: ['startTime', 'coachNote'] }, now)).toEqual({
      $set: { title: 'Race', updatedAt: now },
      $unset: { startTime: '', coachNote: '' },
    });
  });

  it('keeps a value that is both set and cleared', () => {
    expect(eventPatchUpdate({ durationMin: 45, unset: ['durationMin', 'durationLabel'] }, now)).toEqual({
      $set: { durationMin: 45, updatedAt: now },
      $unset: { durationLabel: '' },
    });
  });
});
