import { COURSE_MAX_POINTS } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { analyzeCourse } from './analyze';
import { climbMinutes, climbTimeRange, courseMinutes, formatTimeRange, speedOnGrade } from './estimate';
import { GpxError, parseGpx } from './gpx';
import { climbMarkers, courseLine, courseSummary, profileBars } from './profile';
import { haversineM, resampleTrack } from './track';

/**
 * A made-up course heading due north from 49°N 123°W: each segment is [km, grade %]. Elevation gets
 * deterministic GPS-style noise of ±`noise` m. One degree of latitude is 111.195 km.
 */
function course(segments: [number, number][], opts: { noise?: number; stepM?: number; tag?: 'trkpt' | 'rtept'; noEle?: boolean } = {}) {
  const { noise = 0, stepM = 20, tag = 'trkpt', noEle = false } = opts;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  let lat = 49;
  let ele = 100;
  const pts: string[] = [];
  const add = () => pts.push(`<${tag} lat="${lat.toFixed(6)}" lon="-123.000000">${noEle ? '' : `<ele>${(ele + noise * rnd()).toFixed(1)}</ele>`}</${tag}>`);
  add();
  for (const [km, grade] of segments) {
    for (let i = 0; i < Math.round((km * 1000) / stepM); i++) {
      lat += stepM / 111_195;
      ele += (stepM * grade) / 100;
      add();
    }
  }
  const body = tag === 'trkpt' ? `<trk><name>Track 1</name><trkseg>${pts.join('\n')}</trkseg></trk>` : `<rte><name>Route</name>${pts.join('\n')}</rte>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Made-up Fondo &amp; Friends</name></metadata>${body}</gpx>`;
}
const analyse = (xml: string) => analyzeCourse(resampleTrack(parseGpx(xml).points));

describe('parseGpx (DECISIONS #99)', () => {
  it('reads a track, its name and its heights', () => {
    const gpx = parseGpx(course([[1, 5]]));
    expect(gpx.name).toBe('Made-up Fondo & Friends');
    expect(gpx.points).toHaveLength(51);
    expect(gpx.points[50]!.ele).toBeCloseTo(150, 5);
  });

  it('reads a route file, single quotes and namespaced tags', () => {
    expect(parseGpx(course([[1, 0]], { tag: 'rtept' })).points).toHaveLength(51);
    const odd = `<gpx:gpx xmlns:gpx="x"><gpx:trk><gpx:trkseg><gpx:trkpt lon='-123' lat='49'><gpx:ele>10</gpx:ele></gpx:trkpt><gpx:trkpt lon='-123' lat='49.01'/></gpx:trkseg></gpx:trk></gpx:gpx>`;
    expect(parseGpx(odd).points).toEqual([{ lat: 49, lon: -123, ele: 10 }, { lat: 49.01, lon: -123 }]);
  });

  it('says what is wrong with a file it cannot use', () => {
    expect(() => parseGpx('<tcx></tcx>')).toThrow(GpxError);
    expect(() => parseGpx('<tcx></tcx>')).toThrow('This isn’t a GPX file.');
    expect(() => parseGpx('<gpx><wpt lat="49" lon="-123"/><wpt lat="49.1" lon="-123"/></gpx>')).toThrow('No route in this file.');
  });
});

describe('resampleTrack', () => {
  it('puts a point every 50 m and keeps the end', () => {
    const track = resampleTrack(parseGpx(course([[10, 0]])).points);
    expect(track).toHaveLength(201);
    expect(track[1]![0]).toBeCloseTo(0.05, 3);
    expect(track[200]![0]).toBeCloseTo(10, 2);
    expect(haversineM({ lat: 49, lon: -123 }, { lat: 50, lon: -123 })).toBeCloseTo(111_195, -1);
  });

  it('widens the spacing on a very long course, to stay within the limit', () => {
    const track = resampleTrack(parseGpx(course([[800, 0]], { stepM: 500 })).points);
    expect(track.length).toBeLessThanOrEqual(COURSE_MAX_POINTS);
    expect(track[track.length - 1]![0]).toBeCloseTo(800, 0);
  });

  it('keeps no heights when the file has none', () => {
    expect(resampleTrack(parseGpx(course([[2, 5]], { noEle: true })).points)[3]![1]).toBeNull();
  });
});

describe('analyzeCourse', () => {
  it('finds a known climb within a few tenths of a percent, despite GPS noise', () => {
    const a = analyse(course([[10, 0], [5, 6], [5, -6], [10, 0]], { noise: 1.5 }));
    expect(a.distanceKm).toBeCloseTo(30, 0);
    expect(a.climbs).toHaveLength(1);
    const [c] = a.climbs;
    expect(c!.startKm).toBeGreaterThan(9.7);
    expect(c!.startKm).toBeLessThan(10.4);
    expect(c!.lengthKm).toBeGreaterThan(4.7);
    expect(c!.lengthKm).toBeLessThan(5.3);
    expect(Math.abs(c!.avgPct - 6)).toBeLessThanOrEqual(0.3);
    expect(c!.gainM).toBeGreaterThan(285);
    expect(c!.gainM).toBeLessThan(315);
    expect(c!.longest).toBe(true);
    expect(a.ascentM).toBeGreaterThan(285);
    expect(a.ascentM).toBeLessThan(330);
    expect(a.terrain).toBe('rolling');
  });

  it('finds nothing in noise on the flat', () => {
    const a = analyse(course([[20, 0]], { noise: 2 }));
    expect(a.climbs).toEqual([]);
    expect(a.ascentM).toBeLessThan(40);
    expect(a.terrain).toBe('flat');
  });

  it('keeps a climb with a short dip in it as one climb', () => {
    const a = analyse(course([[2, 0], [3, 6], [0.5, -3], [3, 6], [2, 0]]));
    expect(a.climbs).toHaveLength(1);
    expect(a.climbs[0]!.lengthKm).toBeCloseTo(6.5, 0);
  });

  it('splits two climbs with a long flat between them, and marks the longest', () => {
    const a = analyse(course([[2, 0], [2, 5], [3, 0], [4, 7], [2, 0]]));
    expect(a.climbs.map((c) => [c.n, c.lengthKm, c.longest])).toEqual([
      [1, expect.closeTo(2, 0), false],
      [2, expect.closeTo(4, 0), true],
    ]);
    expect(a.climbs[1]!.maxPct).toBeGreaterThanOrEqual(7);
  });

  it('measures the climbing in the last 20 km', () => {
    const a = analyse(course([[30, 0], [2, 5], [18, 0]]));
    expect(a.finishGainM).toBeGreaterThan(90);
    expect(a.finishGainM).toBeLessThan(110);
  });

  it('says only the distance for a file without heights', () => {
    const a = analyse(course([[12, 4]], { noEle: true }));
    expect(a).toMatchObject({ distanceKm: 12, ascentM: null, climbs: [], profile: [] });
    expect(courseSummary(a)).toBe('12 km');
  });
});

describe('estimates', () => {
  it('climbs at a believable speed', () => {
    // 345 W, 72 kg rider, 6.4%: about 20 km/h.
    expect(speedOnGrade(345, 72, 6.4) * 3.6).toBeGreaterThan(18.5);
    expect(speedOnGrade(345, 72, 6.4) * 3.6).toBeLessThan(21.5);
    const range = climbTimeRange({ lengthKm: 11, avgPct: 6.4 }, 345, 72);
    expect(range[0]).toBeLessThan(range[1]);
    expect(climbMinutes({ lengthKm: 11, avgPct: 6.4 }, 345, 72)).toBeGreaterThan(30);
    expect(climbMinutes({ lengthKm: 11, avgPct: 6.4 }, 345, 72)).toBeLessThan(36);
  });

  it('writes a range the way the panel shows it', () => {
    expect(formatTimeRange([10.2, 11.4])).toBe('≈ 10–11 min');
    expect(formatTimeRange([6.4, 6.6])).toBe('≈ 6–7 min');
    expect(formatTimeRange([8.1, 8.3])).toBe('≈ 8 min');
    expect(formatTimeRange([95, 104])).toBe('≈ 1 h 35–1 h 44');
  });

  it('estimates a fondo’s riding time in the right ballpark', () => {
    const min = courseMinutes({ distanceKm: 142, ascentM: 2350 }, 345, 72);
    expect(min).toBeGreaterThan(4 * 60);
    expect(min).toBeLessThan(6.5 * 60);
  });
});

describe('the chart', () => {
  const a = analyse(course([[10, 0], [5, 6], [5, -6], [10, 0]]));

  it('draws about a bar per km, at least 40, marked with the climb', () => {
    const bars = profileBars(a);
    expect(bars).toHaveLength(40);
    expect(Math.max(...bars.map((b) => b.height))).toBe(100);
    expect(Math.min(...bars.map((b) => b.height))).toBeGreaterThan(0);
    expect(bars.filter((b) => b.climb === 1).length).toBeGreaterThan(5);
    expect(profileBars({ ...a, distanceKm: 300 })).toHaveLength(160);
  });

  it('puts the marker over the middle of the climb, and sums the course up', () => {
    expect(climbMarkers(a)[0]!.leftPct).toBeCloseTo(41, -1);
    expect(courseSummary(a)).toMatch(/^30 km · (29\d|30\d) m · 1 climb$/);
  });
});

describe('courseLine', () => {
  it('puts a course in one line for the coach', () => {
    const a = analyse(course([[10, 0], [5, 6], [5, -6], [10, 0]]));
    expect(courseLine(a)).toMatch(/^1 climb, longest 5(\.\d)? km at (5\.\d|6(\.\d)?)% from km \d+(\.\d)?; last 20 km \+\d+ m$/);
    expect(courseLine(analyse(course([[20, 0]])))).toBe('flat, no climbs; last 20 km +0 m');
    expect(courseLine(analyse(course([[5, 3]], { noEle: true })))).toBe('course without elevation');
  });
});
