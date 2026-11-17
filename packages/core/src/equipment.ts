import type { Activity, Bike, BikeStatus, ChainDue, ChainWear, LocalDateTime, RideKind } from '@cycling-coach/shared';
import { CYCLING_SPORT } from './rides';

/**
 * Bikes and chain wear (DECISIONS #114). A ride takes its kind's default bike once, when it's first
 * settled; the rider can change it, and a default set later never moves a ride that has a bike.
 */

/** At this share of the interval the bar turns amber; at 1 the chain is due. */
export const CHAIN_WARN_SHARE = 0.9;

type RideFacts = Pick<Activity, 'type' | 'isTrainer' | 'source'>;

/** Only rides take a bike: runs, walks and strength sessions never do. */
export function takesBike(a: Pick<Activity, 'type'>): boolean {
  return CYCLING_SPORT.test(a.type);
}

/** Trainer, virtual and Zwift rides are indoor; everything else is outside. */
export function rideKind(a: RideFacts): RideKind {
  return a.isTrainer || /virtual/i.test(a.type) || a.source === 'ZWIFT' ? 'indoor' : 'outdoor';
}

/** The bike a new ride gets, if its kind has a default. */
export function defaultBikeFor(a: RideFacts, bikes: readonly Pick<Bike, 'id' | 'defaultFor'>[]): string | undefined {
  if (!takesBike(a)) return undefined;
  const kind = rideKind(a);
  return bikes.find((b) => b.defaultFor === kind)?.id;
}

/** Whether a ride that started at `startLocal` (`YYYY-MM-DDTHH:mm:ss`) came after a wax. Same minute counts as before. */
export function rodeAfter(startLocal: string, at: LocalDateTime): boolean {
  return startLocal.slice(0, 16) > at;
}

/** Typed dates mean the end of that day: that day's rides were on the old wax. */
export function endOfDay(date: string): LocalDateTime {
  return `${date}T23:59`;
}

export function chainWear(rewaxKm: number, lastWaxedAt: LocalDateTime, rides: readonly Pick<Activity, 'distanceM' | 'startLocal'>[]): ChainWear {
  const since = rides.filter((r) => rodeAfter(r.startLocal, lastWaxedAt));
  const km = round1(since.reduce((s, r) => s + r.distanceM, 0) / 1000);
  const share = km / rewaxKm;
  return { km, rides: since.length, share, due: share >= 1 };
}

/** A bike's totals from every ride it has, and its chain's wear when waxed. */
export function bikeStatus(bike: Bike, rides: readonly Pick<Activity, 'distanceM' | 'startLocal'>[]): BikeStatus {
  const km = round1(rides.reduce((s, r) => s + r.distanceM, 0) / 1000);
  const wear = bike.chain.type === 'waxed' ? chainWear(bike.chain.rewaxKm, bike.chain.lastWaxedAt, rides) : undefined;
  return { ...bike, km, rides: rides.length, ...(wear ? { wear } : {}) };
}

export function chainsDue(bikes: readonly BikeStatus[]): ChainDue[] {
  return bikes.flatMap((b) =>
    b.chain.type === 'waxed' && b.wear?.due
      ? [{ bikeId: b.id, name: b.name, km: b.wear.km, rewaxKm: b.chain.rewaxKm, lastWaxedAt: b.chain.lastWaxedAt }]
      : [],
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;
