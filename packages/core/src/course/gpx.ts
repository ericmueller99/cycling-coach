/**
 * GPX reading (DECISIONS #99), by regex like `zwo.ts`: no XML library, so `core` stays dependency-free
 * and the same code runs in the browser, which reads the file before anything is uploaded.
 */

export type GpxProblem = 'not_gpx' | 'no_route';

/** What the Add event panel says for each. */
export const GPX_PROBLEM_TEXT: Record<GpxProblem, string> = {
  not_gpx: 'This isn’t a GPX file.',
  no_route: 'No route in this file.',
};

export class GpxError extends Error {
  constructor(readonly problem: GpxProblem) {
    super(GPX_PROBLEM_TEXT[problem]);
    this.name = 'GpxError';
  }
}

export interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number | undefined;
}

// Tags may carry a namespace prefix (`<gpx:trkpt>`); attribute quotes may be single or double.
const NS = '(?:[\\w.-]+:)?';
const POINT = new RegExp(`<${NS}(trkpt|rtept)\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${NS}\\1\\s*>)`, 'g');
const LAT = /\blat\s*=\s*["']([^"']+)["']/;
const LON = /\blon\s*=\s*["']([^"']+)["']/;
const ELE = new RegExp(`<${NS}ele>\\s*([^<]+?)\\s*<\\/${NS}ele>`);
const GPX_ROOT = new RegExp(`<${NS}gpx[\\s>]`, 'i');

function text(raw: string): string {
  return raw
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** The route's name: the file's metadata name, else the track's or route's own. */
function nameOf(xml: string): string | undefined {
  const meta = new RegExp(`<${NS}metadata\\b[^>]*>([\\s\\S]*?)<\\/${NS}metadata>`).exec(xml)?.[1];
  const head = new RegExp(`<${NS}(?:trk|rte)\\b[^>]*>([\\s\\S]*?)<${NS}(?:trkseg|rtept)\\b`).exec(xml)?.[1];
  for (const block of [meta, head]) {
    const m = block && new RegExp(`<${NS}name>([\\s\\S]*?)<\\/${NS}name>`).exec(block);
    const name = m ? text(m[1]!).slice(0, 120) : '';
    if (name) return name;
  }
  return undefined;
}

/**
 * Track points (or route points when the file has no track), in order, with elevation when the file
 * has it. Throws `GpxError` for a file that isn't GPX or has no route (waypoints only).
 */
export function parseGpx(xml: string): { name?: string | undefined; points: GpxPoint[] } {
  if (!GPX_ROOT.test(xml)) throw new GpxError('not_gpx');
  const track: GpxPoint[] = [];
  const route: GpxPoint[] = [];
  for (const m of xml.matchAll(POINT)) {
    const lat = Number(LAT.exec(m[2]!)?.[1]);
    const lon = Number(LON.exec(m[2]!)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const eleText = m[3] ? ELE.exec(m[3])?.[1] : undefined;
    const ele = eleText !== undefined ? Number(eleText) : NaN;
    (m[1] === 'trkpt' ? track : route).push({ lat, lon, ...(Number.isFinite(ele) ? { ele } : {}) });
  }
  const points = track.length >= 2 ? track : route;
  if (points.length < 2) throw new GpxError('no_route');
  return { name: nameOf(xml), points };
}
