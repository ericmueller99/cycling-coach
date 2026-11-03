import type { ActivityInterval } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { sessionCompliance } from './compliance';
import { describeFeedback, rpeBand, rpeWord } from './feedback';
import { STARTER_WORKOUTS } from './starter-library';

const vo2 = STARTER_WORKOUTS.find((w) => w.name === 'VO2 5x4')!.segments;
const surge = STARTER_WORKOUTS.find((w) => w.name.startsWith('Surge'))!.segments;
const work = (durationSec: number, avgWatts: number): ActivityInterval => ({ type: 'WORK', durationSec, avgWatts });
const rest = (durationSec: number): ActivityInterval => ({ type: 'RECOVERY', durationSec, avgWatts: 170 });

describe('sessionCompliance', () => {
  it('pairs every rep of a 5×4 and keeps the warm-up opener as an extra', () => {
    const intervals = [work(58, 380), rest(240), ...Array.from({ length: 5 }, () => [work(239, 384), rest(210)]).flat()];
    // 112% of 345 W = 386 W.
    expect(sessionCompliance(vo2, 345, intervals)).toEqual({
      pct: 99,
      band: 'hit',
      repsDone: 5,
      repsPlanned: 5,
      repSec: 240,
      actualRepSec: 239,
      plannedWatts: 386,
      actualWatts: 384,
      extras: [{ durationSec: 58, watts: 380 }],
    });
  });

  it('counts a dropped and a fading rep against the reps, not the power', () => {
    const intervals = [work(240, 386), work(240, 380), work(240, 330), work(240, 384)];
    const c = sessionCompliance(vo2, 345, intervals)!;
    expect(c.repsPlanned).toBe(5);
    expect(c.repsDone).toBe(3);
    expect(c.pct).toBe(96);
    expect(sessionCompliance(vo2, 345, [work(240, 340), work(240, 350)])!.band).toBe('close');
    expect(sessionCompliance(vo2, 345, [work(240, 300)])!.band).toBe('under');
  });

  it('merges back-to-back work steps into one rep (Surge and Settle)', () => {
    const intervals = Array.from({ length: 5 }, () => work(240, 400));
    const c = sessionCompliance(surge, 345, intervals)!;
    expect(c.repsPlanned).toBe(5);
    expect(c.repSec).toBe(240);
    expect(c.extras).toEqual([]);
  });

  it('gives up when nothing lines up with a rep', () => {
    expect(sessionCompliance(vo2, 345, [work(600, 300)])).toBeNull();
    expect(sessionCompliance(vo2, 345, [])).toBeNull();
  });
});

describe('RPE', () => {
  it('uses the compliance words and colour bands', () => {
    expect([1, 3, 5, 7, 9, 10].map(rpeWord)).toEqual(['Very easy', 'Easy', 'Moderate', 'Hard', 'Very hard', 'Max']);
    expect([4, 5, 6, 7, 8, 9].map(rpeBand)).toEqual(['easy', 'moderate', 'moderate', 'hard', 'hard', 'max']);
  });

  it('describes a rating for the coach', () => {
    expect(describeFeedback({ rpe: 4 })).toBe('RPE 4/10 (Easy)');
    expect(describeFeedback({ rpe: 7, note: 'Last two\n were hard.' })).toBe('RPE 7/10 (Hard) · "Last two were hard."');
    expect(describeFeedback({ rpe: 7, note: 'x'.repeat(300) })).toHaveLength('RPE 7/10 (Hard) · ""'.length + 240);
  });
});
