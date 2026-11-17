import { addDays, bikeStatus, chainsDue, defaultBikeFor, localDateTimeIn, takesBike } from '@cycling-coach/core';
import {
  bikeRides,
  clearBikeDefault,
  createBike,
  deleteBike,
  getBike,
  getProfile,
  getStoredActivity,
  listBikes,
  patchBike,
  recordWax,
  ridesWithoutBike,
  setRideBike,
  stampRideBikes,
  type Collections,
} from '@cycling-coach/db';
import type { Bike, BikeInput, BikePatch, ChainDue, EquipmentPayload, IsoDate, LocalDateTime } from '@cycling-coach/shared';
import type { ServiceFailure } from '../app';

/**
 * Bikes, which ride was on which, and waxed-chain wear (DECISIONS #114). A ride gets its kind's
 * default bike once, when it's first settled or when that default is first set; after that only the
 * rider moves it.
 */

/** How far back the Equipment tab looks for rides with no bike. */
const UNASSIGNED_DAYS = 30;

/** Give rides with no bike their kind's default. `from` limits it to recent rides (a `startLocal` bound). */
export async function stampDefaultBikes(c: Collections, userId: string, now: Date, from?: string): Promise<number> {
  const bikes = await listBikes(c, userId);
  if (!bikes.some((b) => b.defaultFor)) return 0;
  const rides = await ridesWithoutBike(c, userId, from);
  const stamps = rides.flatMap((r) => {
    const bikeId = defaultBikeFor(r, bikes);
    return bikeId ? [{ activityId: r.id, bikeId }] : [];
  });
  await stampRideBikes(c, userId, stamps, now);
  return stamps.length;
}

export async function equipment(c: Collections, userId: string, today: IsoDate): Promise<EquipmentPayload> {
  const bikes = await listBikes(c, userId);
  if (!bikes.length) return { bikes: [], unassigned: { rides: 0, km: 0 } };
  const [rides, loose] = await Promise.all([bikeRides(c, userId), ridesWithoutBike(c, userId, addDays(today, -UNASSIGNED_DAYS))]);
  const unassigned = loose.filter(takesBike);
  return {
    bikes: bikes.map((b) => bikeStatus(b, rides.filter((r) => r.bikeId === b.id))),
    unassigned: { rides: unassigned.length, km: Math.round(unassigned.reduce((s, r) => s + r.distanceM, 0) / 1000) },
  };
}

export async function dueChains(c: Collections, userId: string, today: IsoDate): Promise<ChainDue[]> {
  return chainsDue((await equipment(c, userId, today)).bikes);
}

export async function addBike(c: Collections, userId: string, input: BikeInput, now: Date): Promise<Bike> {
  const bike = await createBike(c, userId, input, now);
  if (input.defaultFor) {
    await clearBikeDefault(c, userId, input.defaultFor, bike.id, now);
    await stampDefaultBikes(c, userId, now);
  }
  return bike;
}

export async function changeBike(c: Collections, userId: string, id: string, patch: BikePatch, now: Date): Promise<Bike | null> {
  const before = await getBike(c, userId, id);
  if (!before) return null;
  const bike = await patchBike(c, userId, id, patch, now);
  if (bike?.defaultFor && bike.defaultFor !== before.defaultFor) {
    await clearBikeDefault(c, userId, bike.defaultFor, id, now);
    await stampDefaultBikes(c, userId, now);
  }
  return bike;
}

export function removeBike(c: Collections, userId: string, id: string, now: Date): Promise<boolean> {
  return deleteBike(c, userId, id, now);
}

/** "Mark re-waxed": now in the athlete's time unless they say when. */
export async function markWaxed(c: Collections, userId: string, id: string, at: LocalDateTime | undefined, now: Date): Promise<Bike | ServiceFailure | null> {
  const [bike, profile] = await Promise.all([getBike(c, userId, id), getProfile(c, userId)]);
  if (!bike || !profile) return null;
  if (bike.chain.type !== 'waxed') return { error: 'Only a waxed chain is re-waxed.', status: 400 };
  const when = at ?? localDateTimeIn(profile.timezone, now);
  const status = (await equipment(c, userId, localDateTimeIn(profile.timezone, now).slice(0, 10))).bikes.find((b) => b.id === id);
  return recordWax(c, userId, id, when, status?.wear?.km ?? 0, now);
}

export async function chooseRideBike(c: Collections, userId: string, activityId: string, bikeId: string | null, now: Date): Promise<ServiceFailure | null> {
  const ride = (await getStoredActivity(c, userId, activityId))?.activity;
  if (!ride) return { error: 'That ride isn’t here.', status: 404 };
  if (!takesBike(ride)) return { error: 'Only rides take a bike.', status: 400 };
  if (bikeId && !(await getBike(c, userId, bikeId))) return { error: 'That bike isn’t yours.', status: 404 };
  await setRideBike(c, userId, activityId, bikeId, now);
  return null;
}
