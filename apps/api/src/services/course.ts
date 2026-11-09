import { analyzeCourse, COURSE_ANALYSIS_VERSION } from '@cycling-coach/core';
import { getCourseDoc, setCourseAnalysis, type Collections } from '@cycling-coach/db';
import type { Course } from '@cycling-coach/shared';

/**
 * An event's course (DECISIONS #99), analysed again when the analysis has changed since it was stored.
 * Null when there is none. For the calendar's course route and the coach's `get_event_course`.
 */
export async function readCourse(c: Collections, userId: string, eventId: string): Promise<Course | null> {
  const doc = await getCourseDoc(c, userId, eventId);
  if (!doc) return null;
  let analysis = doc.analysis;
  if (doc.analysisVersion < COURSE_ANALYSIS_VERSION) {
    analysis = analyzeCourse(doc.points);
    await setCourseAnalysis(c, userId, eventId, analysis, COURSE_ANALYSIS_VERSION);
  }
  return { eventId: doc.eventId, ...(doc.name ? { name: doc.name } : {}), ...(doc.fileName ? { fileName: doc.fileName } : {}), analysis };
}
