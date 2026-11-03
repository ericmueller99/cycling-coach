import { describe, expect, it } from 'vitest';
import { accessBasis, categoryNumber, evaluateAccess } from './access';

// The athlete: zFTP 330 W, zMAP 420 W at 83 kg (3.98 / 5.06 W/kg), Cat B, Racing Score 696.
const athlete = { zftp: 330, zmap: 420, weightKg: 83, category: 2, racingScore: 696, zwiftId: 1000001 };

// Real expressions from the research pull (2026-10-31).
const ZFTP_PENS = `((powerCurves.zFTPwkg < 9.9 && powerCurves.zMAPwkg < 9.9) && subgroup.label == 1) ||
((powerCurves.zFTPwkg < 3.9 && powerCurves.zMAPwkg < 4.68) && subgroup.label <= 2) ||
((powerCurves.zFTPwkg < 3.3 && powerCurves.zMAPwkg < 3.96) && subgroup.label <= 3) ||
((powerCurves.zFTPwkg < 2.7 && powerCurves.zMAPwkg < 3.24) && subgroup.label <= 4)`;
const CATEGORY = `(subgroup.label == 1 && powerCurves.category == 0) || (powerCurves.category != 5 && powerCurves.category >= subgroup.label) || (powerCurves.category == 5 && (subgroup.label == 1 || subgroup.label == 5))`;
const RACING_SCORE = `(profile.playerType == "BROADCASTER") ||
(subgroup.label == 1 && profile.profileId != 1554225 && scoring.current <= 1000) ||
(subgroup.label == 2 && scoring.current < 690) ||
(subgroup.label == 3 && scoring.current < 520 ) ||
(subgroup.label == 4 && scoring.current < 350)`;
const CAPPED = `(profile.playerType == "BROADCASTER") ||
(subgroup.label == 1 && scoring.current >= 390 && scoring.current <= 650) ||
(subgroup.label == 2 && scoring.current >= 270 && scoring.current < 510)`;
const MAX30 = `(profile.playerType == "BROADCASTER") ||
(subgroup.label == 1 && scoring.max30 <= 1000) ||
(subgroup.label == 2 && scoring.max30 < 690)`;

const pens = (expr: string, ctx = athlete) => [1, 2, 3, 4, 5].map((label) => evaluateAccess(expr, ctx, label));

describe('evaluateAccess', () => {
  it('zFTP W/kg pens: 3.98 W/kg is A only', () => {
    expect(pens(ZFTP_PENS)).toEqual([true, false, false, false, false]);
    // 3.37 / 4.46 W/kg → A or B.
    expect(pens(ZFTP_PENS, { ...athlete, zftp: 280, zmap: 370 })).toEqual([true, true, false, false, false]);
  });

  it('category pens: B may ride A and B', () => {
    expect(pens(CATEGORY)).toEqual([true, true, false, false, false]);
    expect(pens(CATEGORY, { ...athlete, category: 0 })).toEqual([true, false, false, false, false]);
  });

  it('Racing Score pens', () => {
    expect(pens(RACING_SCORE)).toEqual([true, false, false, false, false]);
    expect(pens(RACING_SCORE, { ...athlete, racingScore: 500 })).toEqual([true, true, true, false, false]);
  });

  it('a capped event the athlete is too strong for', () => {
    expect(pens(CAPPED)).toEqual([false, false, false, false, false]);
  });

  it('unknown values give "can\'t tell", not a guess', () => {
    expect(pens(MAX30)).toEqual([null, null, false, false, false]);
    expect(evaluateAccess(ZFTP_PENS, { weightKg: 83 }, 1)).toBeNull();
  });

  it('true || unknown still lets him in', () => {
    expect(evaluateAccess('subgroup.label == 1 || scoring.max30 < 5', athlete, 1)).toBe(true);
    expect(evaluateAccess('subgroup.label == 2 && scoring.max30 < 5', athlete, 1)).toBe(false);
  });

  it('negation and string comparison', () => {
    expect(evaluateAccess('!(profile.playerType == "BROADCASTER")', athlete, 1)).toBe(true);
    expect(evaluateAccess("profile.playerType != 'NORMAL'", athlete, 1)).toBe(false);
  });

  it('garbage is unknown, never an exception', () => {
    expect(evaluateAccess('subgroup.label ==', athlete, 1)).toBeNull();
    expect(evaluateAccess('foo(1)', athlete, 1)).toBeNull();
    expect(evaluateAccess('a ; b', athlete, 1)).toBeNull();
  });
});

describe('accessBasis / categoryNumber', () => {
  it('names what the rule is based on', () => {
    expect(accessBasis(ZFTP_PENS)).toBe('zftp');
    expect(accessBasis(RACING_SCORE)).toBe('racing_score');
    expect(accessBasis('subgroup.label == 1')).toBeUndefined();
  });

  it("uses Zwift's numbering", () => {
    expect(['A+', 'A', 'B', 'C', 'D', 'E', undefined].map(categoryNumber)).toEqual([0, 1, 2, 3, 4, 5, undefined]);
  });
});
