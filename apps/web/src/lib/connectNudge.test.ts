import { describe, expect, it } from 'vitest';
import { nudgeCopy, nudgeFor } from './connectNudge';

describe('nudgeFor', () => {
  it('waits for both the status and the other source', () => {
    expect(nudgeFor(undefined, false)).toBeUndefined();
    expect(nudgeFor('not_configured', undefined)).toBeUndefined();
    expect(nudgeFor('error', undefined)).toBeUndefined();
  });

  it('asks nothing of a connected athlete, whatever else is connected', () => {
    expect(nudgeFor('connected', false)).toBeUndefined();
    expect(nudgeFor('connected', true)).toBeUndefined();
  });

  it('asks a new athlete to connect', () => {
    expect(nudgeFor('not_configured', false)).toEqual({ kind: 'connect', hasRides: false });
  });

  it('still asks when another source brings rides in, since only intervals.icu sends workouts out', () => {
    expect(nudgeFor('not_configured', true)).toEqual({ kind: 'connect', hasRides: true });
    expect(nudgeFor('error', true)).toEqual({ kind: 'reconnect', hasRides: true });
  });

  it('asks for a reconnect when the connection is broken', () => {
    expect(nudgeFor('error', false)).toEqual({ kind: 'reconnect', hasRides: false });
  });
});

describe('nudgeCopy', () => {
  it('never tells an athlete with rides that the coach is missing them', () => {
    for (const kind of ['connect', 'reconnect'] as const) {
      const { body, row } = nudgeCopy({ kind, hasRides: true });
      expect(row).toContain('send workouts to Zwift');
      expect(row).not.toContain('sees your rides');
      expect(body).not.toContain('without your latest rides');
      expect(body).toContain('Zwift');
    }
  });

  it('leads with the rides for an athlete who has none coming in', () => {
    expect(nudgeCopy({ kind: 'connect', hasRides: false }).row).toBe('Connect intervals.icu so your coach sees your rides');
    expect(nudgeCopy({ kind: 'reconnect', hasRides: false }).row).toBe('Reconnect intervals.icu so your coach sees your rides');
  });
});
