import type { Course, CourseAnalysis, CourseInput } from '@cycling-coach/shared';
import type { Collections, CourseDoc } from '../collections';
import { compact, idOf } from './util';

/**
 * Courses (DECISIONS #99), one per event, keyed by the session's id. The analysis is computed by the
 * caller (`core.analyzeCourse`) and stored with its version, so a newer analysis can replace it on read.
 */

const toCourse = (doc: CourseDoc): Course => compact({ eventId: doc.eventId, name: doc.name, fileName: doc.fileName, analysis: doc.analysis });

/** The stored course with its track, for analysing again. */
export async function getCourseDoc(c: Collections, userId: string, eventId: string): Promise<CourseDoc | null> {
  return c.courses.findOne({ userId, eventId });
}

export async function getCourse(c: Collections, userId: string, eventId: string): Promise<Course | null> {
  const doc = await c.courses.findOne({ userId, eventId }, { projection: { points: 0 } });
  return doc ? toCourse(doc as CourseDoc) : null;
}

/** Courses for these events, without their tracks. */
export async function listCourses(c: Collections, userId: string, eventIds: readonly string[]): Promise<Course[]> {
  if (!eventIds.length) return [];
  const docs = await c.courses.find({ userId, eventId: { $in: [...eventIds] } }, { projection: { points: 0 } }).toArray();
  return docs.map((d) => toCourse(d as CourseDoc));
}

/** Adds or replaces an event's course; returns its id. */
export async function putCourse(
  c: Collections,
  userId: string,
  eventId: string,
  input: CourseInput,
  analysis: CourseAnalysis,
  analysisVersion: number,
  now: Date,
): Promise<{ id: string; course: Course }> {
  const doc: CourseDoc = compact({ userId, eventId, name: input.name, fileName: input.fileName, points: input.points, analysis, analysisVersion, createdAt: now });
  const res = await c.courses.findOneAndReplace({ userId, eventId }, doc, { upsert: true, returnDocument: 'after' });
  return { id: idOf(res!), course: toCourse(doc) };
}

/** A newer analysis for a stored course. */
export async function setCourseAnalysis(c: Collections, userId: string, eventId: string, analysis: CourseAnalysis, analysisVersion: number): Promise<void> {
  await c.courses.updateOne({ userId, eventId }, { $set: { analysis, analysisVersion } });
}

export async function deleteCourse(c: Collections, userId: string, eventId: string): Promise<boolean> {
  return (await c.courses.deleteOne({ userId, eventId })).deletedCount === 1;
}
