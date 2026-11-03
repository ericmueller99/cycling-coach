import type { Activity, StepDay } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { STARTER_WORKOUTS } from '../starter-library';
import { dailyBudget, exerciseKcal, goalPace, macroTargets, plannedSessionKcal, stepsForDay, stepsKcal, type BudgetInputs } from './budget';
import { slotForTime } from './portions';

const ride = (over: Partial<Activity>): Activity => ({
  id: 'a1',
  name: 'zFondo',
  type: 'VirtualRide',
  startLocal: '2026-10-24T09:00:00',
  distanceM: 0,
  movingSec: 7262,
  elapsedSec: 7262,
  ...over,
});

const steps14 = (end: string, each: number): StepDay[] => Array.from({ length: 14 }, (_, i) => ({ date: addDays(end, -14 + i), steps: each }));

describe('steps and exercise', () => {
  it('10k steps at 85 kg ≈ 340 kcal', () => {
    expect(stepsKcal(10_000, 85)).toBe(340);
  });
  it('rides count their kJ; device calories when asked or when there is no power', () => {
    expect(exerciseKcal({ kilojoules: 1803, calories: 1806 }, 'power')).toEqual({ kcal: 1803, basis: 'kJ' });
    expect(exerciseKcal({ kilojoules: 1803, calories: 1806 }, 'device')).toEqual({ kcal: 1806, basis: 'device' });
    expect(exerciseKcal({ calories: 400 }, 'power')).toEqual({ kcal: 400, basis: 'device' });
    expect(exerciseKcal({}, 'power')).toBeNull();
  });
  it('projects a planned library workout from its segments × FTP', () => {
    const vo2 = STARTER_WORKOUTS.find((w) => w.name.startsWith('VO2 5x4'))!;
    const kj = plannedSessionKcal({ type: 'intervals', segments: vo2.segments }, 345);
    // ~64 min averaging roughly 75–85% of 345 W.
    expect(kj).toBeGreaterThan(950);
    expect(kj).toBeLessThan(1150);
    expect(plannedSessionKcal({ type: 'endurance', durationMin: 120 }, 345)).toBe(Math.round((120 * 60 * 0.65 * 345) / 1000));
  });
});

describe('stepsForDay', () => {
  const hist = steps14('2026-11-01', 8000);
  it('past days use the actual count', () => {
    expect(stepsForDay([...steps14('2026-10-31', 8000), { date: '2026-10-31', steps: 11841 }], '2026-10-31', '2026-11-01')).toMatchObject({ used: 11841, basis: 'actual' });
  });
  it('today uses the 14-day average until the day beats it', () => {
    expect(stepsForDay([...hist, { date: '2026-11-01', steps: 2000 }], '2026-11-01', '2026-11-01')).toMatchObject({ used: 8000, basis: 'average', today: 2000 });
    expect(stepsForDay([...hist, { date: '2026-11-01', steps: 25508 }], '2026-11-01', '2026-11-01')).toMatchObject({ used: 25508, basis: 'actual' });
  });
  it('no data → undefined', () => {
    expect(stepsForDay([], '2026-11-01', '2026-11-01')).toBeUndefined();
  });
});

describe('goalPace', () => {
  const goal = { id: 'g', title: 'Race weight', target: 80 };
  it('no goal → maintain', () => {
    expect(goalPace(undefined, 85, '2026-11-01', 0.5)).toMatchObject({ mode: 'maintain', kcalPerDay: 0 });
  });
  it('a dated goal spreads what is left over the weeks left', () => {
    // 5 kg over 10 weeks = 0.5 kg/week ≈ −550 kcal/day
    const p = goalPace({ ...goal, targetDate: '2027-01-10' }, 85, '2026-11-01', 0.5);
    expect(p).toMatchObject({ mode: 'lose', kgPerWeek: -0.5, kcalPerDay: -550 });
  });
  it('an undated goal uses the default pace', () => {
    expect(goalPace(goal, 85, '2026-11-01', 0.5)).toMatchObject({ kgPerWeek: -0.5, kcalPerDay: -550, note: 'No target date — 0.5 kg/week' });
  });
  it('clamps aggressive dates, handles gain and reached', () => {
    expect(goalPace({ ...goal, targetDate: '2026-11-15' }, 85, '2026-11-01', 0.5)).toMatchObject({ kgPerWeek: -1, kcalPerDay: -1100 });
    expect(goalPace({ ...goal, target: 88 }, 85, '2026-11-01', 0.5)).toMatchObject({ mode: 'gain', kgPerWeek: 0.5 });
    expect(goalPace({ ...goal, target: 85.2 }, 85, '2026-11-01', 0.5)).toMatchObject({ mode: 'reached', kcalPerDay: 0 });
  });
});

describe('dailyBudget', () => {
  const base: BudgetInputs = {
    date: '2026-10-24',
    today: '2026-11-01',
    settings: { bmrKcal: 1938, bmrSource: 'scan' },
    weightKg: 85,
    ftp: 345,
    steps: [...steps14('2026-10-24', 7000), { date: '2026-10-24', steps: 11933 }],
    activities: [ride({ kilojoules: 1803, calories: 1806 })],
    planned: [],
    goal: { id: 'g', title: 'Race weight', target: 80 },
  };

  it('adds BMR, living + steps, rides and the goal', () => {
    const b = dailyBudget(base);
    expect(b.ready).toBe(true);
    expect(b.lines.map((l) => [l.key, l.kcal])).toEqual([
      ['base', 1938],
      ['activity', 194 + 406],
      ['exercise', 1803],
      ['goal', -550],
    ]);
    expect(b.total).toBe(1938 + 600 + 1803 - 550);
    expect(b.hardDay).toBe(true);
    expect(b.macros).toEqual({ proteinG: 153, fatG: 72, carbsG: Math.round((b.total - 153 * 4 - 72 * 9) / 4) });
  });

  it('protects hard days only when the switch is on', () => {
    expect(dailyBudget({ ...base, settings: { ...base.settings, protectHardDays: true } }).lines.at(-1)).toMatchObject({ kcal: 0, note: 'hard day — no deficit' });
  });

  it('projects planned sessions for today and later, not for past days', () => {
    const planned = [{ id: 'e1', title: 'Long Z2', type: 'endurance' as const, durationMin: 120 }];
    expect(dailyBudget({ ...base, activities: [], planned }).exercise).toEqual([]);
    expect(dailyBudget({ ...base, date: '2026-11-01', activities: [], planned }).exercise).toMatchObject([{ name: 'Long Z2', basis: 'planned' }]);
  });

  it('falls back to a factor without steps, and waits for BMR', () => {
    const noSteps = dailyBudget({ ...base, steps: [] });
    expect(noSteps.lines[1]).toMatchObject({ kcal: Math.round(1938 * 0.3), note: 'no step data — × 1.3 average day' });
    expect(dailyBudget({ ...base, settings: {} })).toMatchObject({ ready: false, total: 0 });
  });

  it('without a trend weight the goal maintains', () => {
    expect(dailyBudget({ ...base, trendKg: undefined }).goal).toMatchObject({ mode: 'maintain', kcalPerDay: 0, note: 'No trend weight yet' });
  });

  it('a fixed factor replaces steps', () => {
    expect(dailyBudget({ ...base, settings: { ...base.settings, activityMode: 'factor', activityFactor: 1.4 } }).lines[1]!.kcal).toBe(Math.round(1938 * 0.4));
  });
});

describe('macroTargets', () => {
  it('protein and fat by weight, carbs fill the rest', () => {
    expect(macroTargets(3000, 80, { proteinGPerKg: 2, fatGPerKg: 1 })).toEqual({ proteinG: 160, fatG: 80, carbsG: Math.round((3000 - 640 - 720) / 4) });
  });
});

describe('slotForTime', () => {
  const slots = [{ name: 'Breakfast', time: '07:30' }, { name: 'Lunch', time: '12:30' }, { name: 'Dinner', time: '18:30' }, { name: 'Workout fuel' }, { name: 'Snacks' }];
  it('nearest timed meal, else Snacks', () => {
    expect(slotForTime(slots, '08:10')).toBe('Breakfast');
    expect(slotForTime(slots, '13:40')).toBe('Lunch');
    expect(slotForTime(slots, '22:30')).toBe('Snacks');
    expect(slotForTime(slots, '15:30')).toBe('Snacks');
  });
});
