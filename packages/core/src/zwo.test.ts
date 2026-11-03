import { describe, expect, it } from 'vitest';
import { STARTER_WORKOUTS } from './starter-library';
import { flatten } from './workout';
import { buildZwo, parseZwo, zwoFileName } from './zwo';

describe('buildZwo', () => {
  const xml = buildZwo({ ...STARTER_WORKOUTS[1]!, category: 'VO2 max' });

  it('uses Warmup / Cooldown for the opening and closing ramps', () => {
    expect(xml).toContain('<Warmup Duration="600" PowerLow="0.5" PowerHigh="0.75"/>');
    expect(xml).toContain('<Cooldown Duration="600" PowerLow="0.55" PowerHigh="0.45"/>');
  });

  it('writes two-step repeats as IntervalsT', () => {
    expect(xml).toContain(
      '<IntervalsT Repeat="6" OnDuration="180" OffDuration="180" OnPower="1.16" OffPower="0.5"/>',
    );
  });

  it('escapes names', () => {
    expect(buildZwo({ name: 'A & B <x>', segments: [{ kind: 'steady', durSec: 60, pct: 50 }] })).toContain(
      '<name>A &amp; B &lt;x&gt;</name>',
    );
  });
});

describe('parseZwo(buildZwo(w))', () => {
  it.each(STARTER_WORKOUTS.map((w) => [w.name, w] as const))(
    '%s keeps the same power profile',
    (_name, w) => {
      const parsed = parseZwo(buildZwo(w));
      expect(parsed.name).toBe(w.name);
      expect(parsed.warnings).toEqual([]);
      const strip = (steps: ReturnType<typeof flatten>) =>
        steps.map(({ durSec, pct, pctEnd }) => ({ durSec, pct, pctEnd }));
      expect(strip(flatten(parsed.segments))).toEqual(strip(flatten(w.segments)));
    },
  );

  it('keeps on/off structure for two-step repeats', () => {
    const parsed = parseZwo(buildZwo(STARTER_WORKOUTS[0]!));
    expect(parsed.segments.filter((s) => s.kind === 'repeat')).toHaveLength(1);
  });
});

describe('parseZwo on hand-written files', () => {
  it('reads attributes regardless of case and order, and skips text events', () => {
    const parsed = parseZwo(`<workout_file><name>Test</name><workout>
      <SteadyState Power="0.9" Duration="300" Cadence="95"><textevent timeoffset="0" message="go"/></SteadyState>
      <FreeRide Duration="120"/>
    </workout></workout_file>`);
    expect(parsed.segments).toEqual([
      { kind: 'steady', durSec: 300, pct: 90, cadence: 95 },
      { kind: 'steady', durSec: 120, pct: 60 },
    ]);
    expect(parsed.warnings).toHaveLength(1);
  });
});

it('makes safe file names', () => {
  expect(zwoFileName('VO2 30/15s 3x13')).toBe('vo2-30-15s-3x13.zwo');
});

it('reads power ranges as intervals.icu exports them', () => {
  const parsed = parseZwo(`<workout_file><name>VO2 Max: 4x4min</name><workout>
        <SteadyState show_avg="1" PowerHigh="0.55" PowerLow="0.44" Duration="600"/>
        <IntervalsT OnPower="1.13" OffPower="0.463" show_avg="1" Repeat="3" Cadence="105" OffDuration="60" OnDuration="45">
            <textevent message="Activation 3x"/>
        </IntervalsT>
        <SteadyState show_avg="1" PowerHigh="1.188" PowerLow="1.13" Duration="240"/>
        <SteadyState show_avg="1" Power="0.463" Duration="240"/>
  </workout></workout_file>`);
  expect(parsed.segments).toEqual([
    { kind: 'steady', durSec: 600, pct: 50 },
    { kind: 'repeat', count: 3, steps: [{ durSec: 45, pct: 113, cadence: 105 }, { durSec: 60, pct: 46 }] },
    { kind: 'steady', durSec: 240, pct: 116 },
    { kind: 'steady', durSec: 240, pct: 46 },
  ]);
  expect(parsed.warnings).toEqual([]);
});
