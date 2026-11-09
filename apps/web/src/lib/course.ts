import { analyzeCourse, GpxError, parseGpx, resampleTrack } from '@cycling-coach/core';
import type { CourseAnalysis, CourseInput } from '@cycling-coach/shared';

/** The largest GPX the browser will read. Route exports are a few MB; a 25 MB file is a long recorded ride. */
export const GPX_MAX_BYTES = 25 * 1024 * 1024;

/** A GPX read in the browser: what's sent (the resampled track) and what it shows straight away. */
export interface ReadCourse {
  input: CourseInput;
  analysis: CourseAnalysis;
}

/**
 * Reads a GPX file on the device (DECISIONS #99). The raw file is never uploaded; only the track at a
 * 50 m spacing is. Errors come back in the Add event panel's words.
 */
export async function readGpxFile(file: File): Promise<ReadCourse> {
  if (file.size > GPX_MAX_BYTES) throw new Error('That file is over 25 MB.');
  let xml: string;
  try {
    xml = await file.text();
  } catch {
    throw new Error('Couldn’t read that file.');
  }
  const gpx = parseGpx(xml);
  const points = resampleTrack(gpx.points);
  return {
    input: { ...(gpx.name ? { name: gpx.name } : {}), fileName: file.name.slice(0, 200), points },
    analysis: analyzeCourse(points),
  };
}

/** The words for a failed read: a GPX problem says itself; anything else is "not a GPX file". */
export function courseError(err: unknown): string {
  if (err instanceof GpxError) return err.message;
  if (err instanceof Error && /25 MB|read that file/.test(err.message)) return err.message;
  return 'This isn’t a GPX file.';
}
