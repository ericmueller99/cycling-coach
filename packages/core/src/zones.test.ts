import { describe, expect, it } from 'vitest';
import { wattsPerKg, zoneFor, zoneWatts } from './zones';

describe('zones', () => {
  it.each([
    [55, 'Z1'],
    [56, 'Z2'],
    [75, 'Z2'],
    [76, 'Z3'],
    [105, 'Z4'],
    [106, 'Z5'],
    [120, 'Z5'],
    [121, 'Z6'],
  ])('%i%% is %s', (pct, zone) => {
    expect(zoneFor(pct).zone).toBe(zone);
  });

  it('gives Z2 watts at 345 W FTP', () => {
    expect(zoneWatts('Z2', 345)).toEqual([193, 259]);
  });

  it('computes W/kg like the Profile screen (345 W / 83 kg = 4.16)', () => {
    expect(wattsPerKg(345, 83)).toBe(4.16);
  });
});
