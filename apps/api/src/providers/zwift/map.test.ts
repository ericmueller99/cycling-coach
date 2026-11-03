import { describe, expect, it } from 'vitest';
import { mapZwift } from './map';

// Shapes per Sauce4Zwift / zwift-api-wrapper; trimmed to the fields we read plus some we don't.
const profile = {
  id: 1000001,
  firstName: 'Sam',
  ftp: 345,
  weight: 83400,
  competitionMetrics: null, // What `/me` really sends; the by-id profile has it.
};
const publicProfile = { id: 1000001, competitionMetrics: { racingScore: 512.4, category: 'B', categoryWomen: 'B' } };
const powerProfile = {
  zftp: 330.6,
  zmap: 420,
  vo2max: 58.1,
  category: 'B',
  categoryIndex: 2,
  weightInGrams: 83400,
  metricsTimestamp: '2026-10-28T19:02:11.000Z',
};

describe('mapZwift', () => {
  it('maps the profile and power profile', () => {
    expect(mapZwift(profile, powerProfile, publicProfile)).toEqual({
      zwiftId: '1000001',
      ftp: 345,
      weightKg: 83.4,
      zftp: 331,
      zmap: 420,
      category: 'B',
      racingScore: 512,
      metricsAt: '2026-10-28T19:02:11.000Z',
    });
  });

  it('falls back to Racing Score on /me, and leaves it out when neither has it', () => {
    expect(mapZwift({ ...profile, competitionMetrics: publicProfile.competitionMetrics }, powerProfile).racingScore).toBe(512);
    expect(mapZwift(profile, powerProfile, { id: 1000001, competitionMetrics: null }).racingScore).toBeUndefined();
  });

  it('keeps weight and FTP when the power profile is missing', () => {
    expect(mapZwift(profile, null)).toMatchObject({ ftp: 345, weightKg: 83.4, zftp: undefined, category: undefined, metricsAt: undefined });
  });

  it('ignores zeroes, unknown categories and junk', () => {
    expect(mapZwift({ id: 1, ftp: 0, weight: 0 }, { zftp: 0, category: 'X' })).toMatchObject({ ftp: undefined, weightKg: undefined, zftp: undefined, category: undefined });
    expect(mapZwift('nope', [])).toEqual(expect.objectContaining({ zwiftId: undefined }));
  });
});
