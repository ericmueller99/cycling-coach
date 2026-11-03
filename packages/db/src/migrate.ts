import type { Db } from 'mongodb';
import { collections } from './collections';

/**
 * Idempotent data migrations, run at boot after `ensureIndexes`. Each step only touches documents
 * still in the old shape, so running it again is a no-op.
 */
export async function migrate(db: Db): Promise<void> {
  const c = collections(db);

  // TrainerRoad is gone (DECISIONS #20).
  await c.profiles.updateMany({ ftpTrainerRoad: { $exists: true } } as never, { $unset: { ftpTrainerRoad: '' } });

  // Session kinds (DECISIONS #17): infer them for sessions created before kinds existed.
  await c.calendarEvents.updateMany({ kind: { $exists: false }, workoutId: { $exists: true } }, { $set: { kind: 'workout' } });
  await c.calendarEvents.updateMany({ kind: { $exists: false }, type: 'race' }, { $set: { kind: 'race' } });
  await c.calendarEvents.updateMany({ kind: { $exists: false } }, { $set: { kind: 'ride' } });
  await c.calendarEvents.updateMany({ kind: { $in: ['workout', 'race'] }, platform: { $exists: false } }, { $set: { platform: 'zwift' } });

  // The old push-only link {eventId, pushedAt} becomes a sync link.
  const old = await c.calendarEvents.find({ 'intervals.pushedAt': { $exists: true } } as never).toArray();
  for (const e of old) {
    const link = e.intervals as unknown as { eventId: number; pushedAt: string };
    await c.calendarEvents.updateOne(
      { _id: e._id },
      { $set: { intervals: { eventId: link.eventId, syncedAt: link.pushedAt } } },
    );
  }

  // Goals stop storing current values (DECISIONS #19): {current, target, unit} → a live measure.
  const goals = await c.goals.find({ metric: { $exists: true } } as never).toArray();
  for (const g of goals) {
    const metric = (g as unknown as { metric: { current: number; target: number; unit: string } }).metric;
    const measure = /w\/kg/i.test(metric.unit)
      ? { kind: 'wkg' as const, weight: 'zwift' as const }
      : { kind: 'manual' as const, current: metric.current, unit: metric.unit };
    await c.goals.updateOne({ _id: g._id }, { $set: { measure, target: metric.target }, $unset: { metric: '' } } as never);
  }

  // "Ride fuel" became "Workout fuel": any exercise, not only rides.
  await c.foodLog.updateMany({ slot: 'Ride fuel' }, { $set: { slot: 'Workout fuel' } });
  await c.meals.updateMany({ slot: 'Ride fuel' }, { $set: { slot: 'Workout fuel' } });
  await c.foodSettings.updateMany({ 'slots.name': 'Ride fuel' }, { $set: { 'slots.$[s].name': 'Workout fuel' } }, { arrayFilters: [{ 's.name': 'Ride fuel' }] });

  // Profiles from before weight sync.
  await c.profiles.updateMany({ weightSource: { $exists: false } }, { $set: { weightSource: 'manual' } });

  // The ±400-day boot backfill is gone (DECISIONS #49); a full import sets `lastFullSyncAt` instead.
  await c.integrations.updateMany({ lastBackfillAt: { $exists: true } } as never, { $unset: { lastBackfillAt: '' } });
}
