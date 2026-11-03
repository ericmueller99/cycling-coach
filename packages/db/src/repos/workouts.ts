import type { Workout, WorkoutInput } from '@cycling-coach/shared';
import type { Collections, WorkoutDoc } from '../collections';
import { compact, idOf, oid } from './util';

const toWorkout = (doc: WorkoutDoc): Workout => {
  const { _id, userId: _u, createdAt, archivedAt: _a, ...rest } = doc;
  return compact({ ...rest, id: idOf(doc), createdAt: createdAt.toISOString() });
};

export async function listWorkouts(c: Collections, userId: string): Promise<Workout[]> {
  const docs = await c.workouts
    .find({ userId, archivedAt: { $exists: false } })
    // _id breaks ties: seeded workouts share one createdAt.
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return docs.map(toWorkout);
}

export async function getWorkout(c: Collections, userId: string, id: string): Promise<Workout | null> {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.workouts.findOne({ _id, userId });
  return doc ? toWorkout(doc) : null;
}

export async function createWorkout(
  c: Collections,
  userId: string,
  input: WorkoutInput,
  source: WorkoutDoc['source'],
  now: Date,
): Promise<Workout> {
  const doc: WorkoutDoc = { ...compact(input), userId, source, createdAt: now };
  const res = await c.workouts.insertOne(doc);
  return toWorkout({ ...doc, _id: res.insertedId });
}

export async function setWorkoutInZwift(c: Collections, userId: string, id: string, inZwift: boolean) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await c.workouts.findOneAndUpdate(
    { _id, userId },
    { $set: { inZwift } },
    { returnDocument: 'after' },
  );
  return doc ? toWorkout(doc) : null;
}

export async function archiveWorkout(c: Collections, userId: string, id: string, now: Date) {
  const _id = oid(id);
  if (!_id) return false;
  return (await c.workouts.updateOne({ _id, userId }, { $set: { archivedAt: now } })).modifiedCount === 1;
}
