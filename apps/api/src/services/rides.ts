import { matchActivities, missedEventIds, shadowedRides } from '@cycling-coach/core';
import { deleteActivities, listActivities, listEvents, patchEvent, replaceRideReferences, type Collections } from '@cycling-coach/db';
import type { IsoDate } from '@cycling-coach/shared';

/** How far back `Core.rides` settles after new rides. The sync passes its own window. */
export const MATCH_DAYS = 21;

/**
 * Put the stored rides in order, whichever source just wrote (DECISIONS #71): drop second-source rides
 * intervals.icu also has, then tick off sessions from what's left and mark the missed ones.
 */
export async function settleRides(c: Collections, userId: string, from: IsoDate, today: IsoDate, now: Date): Promise<{ matched: number; missed: number }> {
  const listed = await listActivities(c, userId, from, today);
  const shadowed = shadowedRides(listed);
  for (const { id, twinId } of shadowed) await replaceRideReferences(c, userId, id, twinId, now);
  await deleteActivities(c, userId, shadowed.map((s) => s.id));

  const gone = new Set(shadowed.map((s) => s.id));
  const rides = listed.filter((a) => !gone.has(a.id));
  const events = await listEvents(c, userId, from, today);
  const matchable = events.map((e) => ({ ...e, intervalsEventId: e.intervals?.eventId, distanceKm: e.eventInfo?.distanceKm }));
  const pairs = matchActivities(
    matchable,
    rides.map((a) => ({
      id: a.id,
      startLocal: a.startLocal,
      name: a.name,
      sportType: a.type,
      movingSec: a.movingSec,
      pairedEventId: a.pairedEventId,
      ...(a.distanceM > 0 ? { distanceKm: a.distanceM / 1000 } : {}),
    })),
    today,
  );
  for (const p of pairs) await patchEvent(c, userId, p.eventId, { status: 'done', activityId: p.activityId }, now);
  const matchedIds = new Set(pairs.map((p) => p.eventId));
  const missed = missedEventIds(matchable.filter((e) => !matchedIds.has(e.id)), today);
  for (const id of missed) await patchEvent(c, userId, id, { status: 'missed' }, now);
  return { matched: pairs.length, missed: missed.length };
}
