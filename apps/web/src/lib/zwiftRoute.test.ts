import type { Climb } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { groupClimbs, groupSegments, parseLaps, routeTotals, searchRoutes, wherePhrase } from './zwiftRoute';

const climb = (n: number, startKm: number, extra: Partial<Climb> = {}): Climb => ({ n, startKm, lengthKm: 1, gainM: 40, avgPct: 4, maxPct: 6, topM: 100, longest: false, ...extra });

describe('Zwift race routes in the panel (DECISIONS #102)', () => {
  it('lists each named climb once, numbered in riding order, with every lap it comes round', () => {
    const { groups, labelOf } = groupClimbs({
      climbs: [
        climb(1, 1.2, { name: 'Made-up KOM', category: '4' }),
        climb(2, 3.0),
        climb(3, 5.3, { name: 'Made-up KOM', category: '4', longest: true }),
      ],
    });
    expect(groups.map((g) => [g.label, g.name, g.startsKm, g.longest])).toEqual([
      [1, 'Made-up KOM', [1.2, 5.3], true],
      [2, undefined, [3.0], false],
    ]);
    expect([1, 2, 3].map(labelOf)).toEqual(['1', '2', '1']);
  });

  it('lists sprints and other segments once, leaving climbs to the analysis', () => {
    const groups = groupSegments([
      { name: 'Made-up KOM', kind: 'climb', lap: 1, startKm: 1, endKm: 2 },
      { name: 'Made-up Sprint', kind: 'sprint', lap: 1, startKm: 3.4, endKm: 3.7 },
      { name: 'Made-up Sprint', kind: 'sprint', lap: 2, startKm: 7.5, endKm: 7.8 },
    ]);
    expect(groups).toEqual([{ name: 'Made-up Sprint', kind: 'sprint', lengthKm: 0.3, startsKm: [3.4, 7.5] }]);
    expect(wherePhrase(groups[0]!.startsKm)).toBe('×2 · first at km 3.4');
    expect(wherePhrase([12])).toBe('km 12.0');
  });

  it('totals a route: lead-in once, then every lap', () => {
    const r = { distanceKm: 4.1, ascentM: 20, leadinKm: 2.8, leadinAscentM: 20 };
    expect(routeTotals(r, 6)).toEqual({ km: 27.4, ascentM: 140 });
    expect(routeTotals(r, undefined)).toEqual({ km: 6.9, ascentM: 40 });
  });

  it('reads the laps field', () => {
    expect(parseLaps('')).toBeUndefined();
    expect(parseLaps('0')).toBeUndefined();
    expect(parseLaps('abc')).toBeUndefined();
    expect(parseLaps('6')).toBe(6);
    expect(parseLaps('80')).toBe(50);
  });

  it('finds routes by name, starts-with first, or by world', () => {
    const routes = [
      { name: 'Big Loop', world: 'Watopia' },
      { name: 'Loop de Loop', world: 'Watopia' },
      { name: 'Lady Liberty', world: 'New York' },
    ];
    expect(searchRoutes(routes, 'loop').map((r) => r.name)).toEqual(['Loop de Loop', 'Big Loop']);
    expect(searchRoutes(routes, 'new york').map((r) => r.name)).toEqual(['Lady Liberty']);
    expect(searchRoutes(routes, ' ')).toHaveLength(3);
  });
});
