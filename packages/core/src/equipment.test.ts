import type { Activity, Bike } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { localDateTimeIn } from './dates';
import { bikeStatus, chainWear, chainsDue, defaultBikeFor, endOfDay, rideKind, rodeAfter, takesBike } from './equipment';

const ride = (startLocal: string, km: number) => ({ startLocal, distanceM: km * 1000 });

const bike = (over: Partial<Bike> = {}): Bike => ({
  id: 'b1',
  name: 'Road bike',
  chain: { type: 'waxed', rewaxKm: 300, lastWaxedAt: '2026-11-01T23:59' },
  waxes: [],
  ...over,
});

describe('rideKind', () => {
  it('counts trainer, virtual and Zwift rides as indoor', () => {
    expect(rideKind({ type: 'VirtualRide' })).toBe('indoor');
    expect(rideKind({ type: 'Ride', isTrainer: true })).toBe('indoor');
    expect(rideKind({ type: 'Ride', source: 'ZWIFT' })).toBe('indoor');
    expect(rideKind({ type: 'Ride', source: 'GARMIN_CONNECT' })).toBe('outdoor');
    expect(rideKind({ type: 'GravelRide', isTrainer: false })).toBe('outdoor');
  });
});

describe('defaultBikeFor', () => {
  const bikes = [
    { id: 'road', defaultFor: 'outdoor' as const },
    { id: 'gravel' },
    { id: 'trainer', defaultFor: 'indoor' as const },
  ];
  it("gives a ride its kind's default", () => {
    expect(defaultBikeFor({ type: 'VirtualRide' }, bikes)).toBe('trainer');
    expect(defaultBikeFor({ type: 'Ride' }, bikes)).toBe('road');
  });
  it('gives nothing without a default, or to a run', () => {
    expect(defaultBikeFor({ type: 'Ride' }, [{ id: 'gravel' }])).toBeUndefined();
    expect(defaultBikeFor({ type: 'Run' }, bikes)).toBeUndefined();
    expect(takesBike({ type: 'Run' } as Pick<Activity, 'type'>)).toBe(false);
  });
});

describe('chain wear', () => {
  it('counts only rides after the wax; a typed date means the end of that day', () => {
    expect(endOfDay('2026-11-01')).toBe('2026-11-01T23:59');
    expect(rodeAfter('2026-11-01T18:00:00', '2026-11-01T23:59')).toBe(false);
    expect(rodeAfter('2026-11-02T06:00:00', '2026-11-01T23:59')).toBe(true);
    expect(rodeAfter('2026-11-02T06:00:30', '2026-11-02T06:00')).toBe(false);
  });

  it('is due at the interval, not before', () => {
    const rides = [ride('2026-11-01T10:00:00', 80), ride('2026-11-02T10:00:00', 150), ride('2026-11-03T10:00:00', 149.9)];
    expect(chainWear(300, '2026-11-01T23:59', rides)).toMatchObject({ km: 299.9, rides: 2, due: false });
    const more = [...rides, ride('2026-11-04T10:00:00', 0.1)];
    expect(chainWear(300, '2026-11-01T23:59', more)).toMatchObject({ km: 300, rides: 3, share: 1, due: true });
  });

  it("totals every ride on the bike, and has no wear on a lubed chain", () => {
    const rides = [ride('2026-10-01T10:00:00', 50), ride('2026-11-05T10:00:00', 40)];
    expect(bikeStatus(bike(), rides)).toMatchObject({ km: 90, rides: 2, wear: { km: 40, rides: 1 } });
    expect(bikeStatus(bike({ chain: { type: 'lubed' } }), rides).wear).toBeUndefined();
  });

  it('lists only due waxed chains', () => {
    const due = bikeStatus(bike(), [ride('2026-11-05T10:00:00', 310)]);
    const fine = bikeStatus(bike({ id: 'b2' }), [ride('2026-11-05T10:00:00', 10)]);
    expect(chainsDue([due, fine])).toEqual([{ bikeId: 'b1', name: 'Road bike', km: 310, rewaxKm: 300, lastWaxedAt: '2026-11-01T23:59' }]);
  });
});

describe('localDateTimeIn', () => {
  it("formats the athlete's wall clock", () => {
    expect(localDateTimeIn('Asia/Tokyo', new Date('2026-11-17T20:05:00Z'))).toBe('2026-11-18T05:05');
    expect(localDateTimeIn('UTC', new Date('2026-11-17T23:59:59Z'))).toBe('2026-11-17T23:59');
  });
});
