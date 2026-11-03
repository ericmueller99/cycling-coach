import { readFileSync } from 'node:fs';
import { deriveEvent, eligibility } from '@cycling-coach/core';
import { describe, expect, it } from 'vitest';
import { mapEvent, mapRoutes, signedUpPens } from './events-map';

// Trimmed from the live feeds (research pull, 2026-10-31).
const raw = JSON.parse(readFileSync(new URL('./fixtures/events.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
const routes = new Map(mapRoutes(readFileSync(new URL('./fixtures/routes.xml', import.meta.url), 'utf8')).map((r) => [r.id, r]));
const routeOf = (id: number | undefined) => (id === undefined ? undefined : routes.get(id));
const byName = (re: RegExp) => raw.find((e) => re.test(String(e['name'])))!;
const derived = (re: RegExp) => deriveEvent(mapEvent(byName(re))!, routeOf, 'public')!;

const athlete = { ftp: 345, weightKg: 85.5, zwiftWeightKg: 83, zftp: 330, zmap: 420, category: 'B', racingScore: 696, zwiftId: 1000001 };

describe('mapRoutes', () => {
  it('reads cycling routes and skips climb-portal entries', () => {
    expect(routes.get(2128890027)).toEqual({
      id: 2128890027,
      name: 'Tempus Fugit',
      world: 'Watopia',
      distanceM: 17231.3,
      ascentM: 25.6,
      leadinM: 2355.5,
      leadinAscentM: 6.2,
    });
    expect(routes.has(10003)).toBe(false); // "Cote de Pike" portal: no map
  });
});

describe('mapEvent', () => {
  it('maps the fields we use and normalises times to UTC ISO', () => {
    const s = mapEvent(byName(/^Stage 5 - Race - Tour of Watopia/))!;
    expect(s).toMatchObject({ eventType: 'RACE', sport: 'CYCLING', mapId: undefined });
    expect(s.start).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/);
    expect(s.pens.map((p) => p.label)).toEqual([1, 2, 3, 4, 5]);
    expect(s.pens.map((p) => p.rangeLabel)).toEqual(['510-650', '390-510', '270-390', '160-270', '0-160']);
  });

  it('keeps unlock tags but drops physics overrides and timestamps', () => {
    const tags = raw.flatMap((e) => mapEvent(e)?.tags ?? []);
    expect(tags.some((t) => /^(timestamp|bike_cda|front_wheel)/.test(t))).toBe(false);
    expect(tags.every((t) => !t.includes('='))).toBe(true);
  });

  it('rejects things that are not events', () => {
    expect(mapEvent(null)).toBeNull();
    expect(mapEvent({ id: 1 })).toBeNull();
  });

  it('reads sign-ups from pen flags', () => {
    expect(signedUpPens({ eventSubgroups: [{ id: 1, signedUp: true }, { id: 2, signedUp: false }] })).toEqual([1]);
    expect(signedUpPens({})).toEqual([]);
  });
});

describe('real events end to end', () => {
  it('Tour of Watopia ride: distance options Long / Standard / Short', () => {
    const e = derived(/^Stage 5 - Tour of Watopia 2026$/);
    expect(e.penKind).toBe('distance');
    expect(e.pens.map((p) => p.name)).toEqual(['Long', 'Standard', 'Short']);
    expect(e.pens.every((p) => p.km !== undefined)).toBe(true);
    expect(e.series).toBe('tour_of_watopia');
  });

  it('Tour of Watopia race: Racing Score pens he can enter', () => {
    const e = derived(/^Stage 5 - Race - Tour of Watopia/);
    expect(e.penKind).toBe('category');
    const me = eligibility(e, athlete);
    expect(me.basis).toBe('racing_score');
  });

  it('a zFTP race puts Cat B in pen B', () => {
    const e = derived(/Rhino Crash/);
    const me = eligibility(e, athlete);
    expect(me).toMatchObject({ canEnter: true, basis: 'zftp' });
    expect(e.pens.find((p) => p.id === me.myPenId)?.name).toBe('B');
    // Its rules exclude riders by id, so without his Zwift id we can't tell.
    expect(eligibility(e, { ...athlete, zwiftId: undefined }).canEnter).toBeNull();
  });

  it('women-only race is flagged', () => {
    expect(derived(/Women Only/).womenOnly).toBe(true);
  });

  it('a running race is dropped', () => {
    expect(deriveEvent(mapEvent(raw.find((e) => e['sport'] === 'RUNNING'))!, routeOf, 'public')).toBeNull();
  });

  it('Everesting race: two distance options', () => {
    const e = derived(/Everesting/);
    expect(e.penKind).toBe('distance');
    expect(e.pens.map((p) => p.km)).toEqual([110.2, 56.3]);
  });
});
