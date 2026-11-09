import { COURSE_MAX_POINTS } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { analyzeCourse } from './analyze';
import { analyzeZwiftCourse, lapKmOf, zwiftRouteTrack, zwiftSegments, type RouteSegmentOnLap, type RouteStream } from './zwift';

/** A made-up lap from [km, grade %] pieces, a point every `stepM`, starting at 20 m. */
function lap(pieces: [number, number][], stepM = 10): RouteStream {
  const distanceM = [0];
  const altitudeM = [20];
  for (const [km, grade] of pieces) {
    for (let i = 0; i < Math.round((km * 1000) / stepM); i++) {
      distanceM.push(distanceM[distanceM.length - 1]! + stepM);
      altitudeM.push(altitudeM[altitudeM.length - 1]! + (stepM * grade) / 100);
    }
  }
  return { distanceM, altitudeM };
}

/** 2 km flat, a 1.5 km climb at 6% (90 m), 1.5 km back down, 1 km flat: a 6 km loop. */
const loop = lap([
  [2, 0],
  [1.5, 6],
  [1.5, -6],
  [1, 0],
]);
const kom: RouteSegmentOnLap = { fromKm: 2, toKm: 3.5, name: 'Made-up KOM', kind: 'climb', category: '4' };
const sprint: RouteSegmentOnLap = { fromKm: 5.4, toKm: 5.7, name: 'Made-up Sprint', kind: 'sprint' };

describe('zwiftRouteTrack (DECISIONS #102)', () => {
  it('lays out the lead-in flat, then the lap as many times as there are laps', () => {
    const track = zwiftRouteTrack(loop, { leadinKm: 0.5, laps: 3 });
    expect(lapKmOf(loop)).toBe(6);
    expect(track[0]).toEqual([0, 20, 0, 0]);
    expect(track[track.length - 1]![0]).toBeCloseTo(18.5, 3);
    // Every point 50 m apart, the lead-in flat.
    expect(track[1]![0]).toBeCloseTo(0.05, 3);
    expect(track.filter((p) => p[0] <= 0.5).every((p) => p[1] === 20)).toBe(true);
    // The top of the climb on lap 2: 0.5 lead-in + 6 + 3.5 km.
    const top = track.find((p) => Math.abs(p[0] - 10) < 1e-6)!;
    expect(top[1]).toBeCloseTo(110, 1);
    const a = analyzeCourse(track);
    expect(a.distanceKm).toBe(18.5);
    expect(a.ascentM).toBeGreaterThan(3 * 90 * 0.95);
    expect(a.ascentM).toBeLessThan(3 * 90 * 1.05);
  });

  it('widens the spacing to stay within the point cap on a long race', () => {
    const track = zwiftRouteTrack(loop, { leadinKm: 0, laps: 50 });
    expect(track.length).toBeLessThanOrEqual(COURSE_MAX_POINTS);
    expect(track[track.length - 1]![0]).toBeCloseTo(300, 3);
  });

  it('returns nothing for a stream it cannot use', () => {
    expect(zwiftRouteTrack({ distanceM: [0], altitudeM: [10] }, { leadinKm: 0, laps: 1 })).toEqual([]);
    expect(zwiftRouteTrack({ distanceM: [0, 10], altitudeM: [10] }, { leadinKm: 0, laps: 1 })).toEqual([]);
  });
});

describe('zwiftSegments', () => {
  it('repeats each segment per lap, at km from the start, in riding order', () => {
    const segs = zwiftSegments([kom, sprint], { leadinKm: 0.5, lapKm: 6, laps: 2 });
    expect(segs.map((s) => [s.name, s.lap, s.startKm, s.endKm])).toEqual([
      ['Made-up KOM', 1, 2.5, 4],
      ['Made-up Sprint', 1, 5.9, 6.2],
      ['Made-up KOM', 2, 8.5, 10],
      ['Made-up Sprint', 2, 11.9, 12.2],
    ]);
    expect(segs[0]!.category).toBe('4');
    expect(segs[1]).not.toHaveProperty('category');
  });
});

describe('analyzeZwiftCourse', () => {
  it('names the found climb a KOM overlaps, once per lap, and numbers them from the start', () => {
    const track = zwiftRouteTrack(loop, { leadinKm: 0.5, laps: 2 });
    expect(analyzeCourse(track).climbs).toHaveLength(2);
    const a = analyzeZwiftCourse(track, zwiftSegments([kom, sprint], { leadinKm: 0.5, lapKm: 6, laps: 2 }));
    expect(a.climbs.map((c) => [c.n, c.name, c.category, c.startKm])).toEqual([
      [1, 'Made-up KOM', '4', 2.5],
      [2, 'Made-up KOM', '4', 8.5],
    ]);
    expect(a.climbs[0]!.lengthKm).toBeCloseTo(1.5, 1);
    expect(a.climbs[0]!.avgPct).toBeGreaterThan(5);
    expect(a.climbs[0]!.avgPct).toBeLessThan(6.5);
    expect(a.climbs.filter((c) => c.longest)).toHaveLength(1);
  });

  it('keeps found climbs no named segment covers, unnamed', () => {
    const track = zwiftRouteTrack(loop, { leadinKm: 0, laps: 1 });
    const a = analyzeZwiftCourse(track, zwiftSegments([sprint], { leadinKm: 0, lapKm: 6, laps: 1 }));
    expect(a.climbs).toHaveLength(1);
    expect(a.climbs[0]!.name).toBeUndefined();
  });

  it('counts a named climb too small to be found', () => {
    const gentle = lap([
      [1, 0],
      [0.4, 4],
      [1, 0],
    ]);
    const track = zwiftRouteTrack(gentle, { leadinKm: 0, laps: 1 });
    expect(analyzeCourse(track).climbs).toHaveLength(0);
    const a = analyzeZwiftCourse(track, zwiftSegments([{ fromKm: 1, toKm: 1.4, name: 'Little Rise', kind: 'climb' }], { leadinKm: 0, lapKm: 2.4, laps: 1 }));
    expect(a.climbs.map((c) => c.name)).toEqual(['Little Rise']);
  });
});
