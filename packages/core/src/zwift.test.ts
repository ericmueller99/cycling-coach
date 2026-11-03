import { describe, expect, it } from 'vitest';
import { zwiftCategory, zwiftCategoryTable } from './zwift';

describe('zwiftCategory', () => {
  it('is B below the A lines and says what A takes at this weight', () => {
    expect(zwiftCategory({ zftp: 330, zmap: 420, weightKg: 83 })).toEqual({
      category: 'B',
      zftpWkg: 3.98,
      zmapWkg: 5.06,
      nextUp: { category: 'A', zftpWkg: 4.2, zftpWatts: 349, zmapWkg: 5.1, zmapWatts: 424 },
    });
  });

  it('is A on zFTP at exactly 4.2 W/kg, with A+ next on zFTP only', () => {
    expect(zwiftCategory({ zftp: 336, weightKg: 80 })).toMatchObject({ category: 'A', nextUp: { category: 'A+', zftpWkg: 4.6, zftpWatts: 368 } });
    expect(zwiftCategory({ zftp: 336, weightKg: 80 })?.nextUp).not.toHaveProperty('zmapWatts');
  });

  it('is A+ at 4.6 W/kg only above 300 W, and never on zMAP', () => {
    expect(zwiftCategory({ zftp: 368, weightKg: 80 })).toMatchObject({ category: 'A+', nextUp: undefined });
    expect(zwiftCategory({ zftp: 299, weightKg: 65 })?.category).toBe('A');
    expect(zwiftCategory({ zftp: 300, zmap: 600, weightKg: 70 })?.category).toBe('A');
  });

  it('is A on zMAP alone', () => {
    expect(zwiftCategory({ zftp: 300, zmap: 430, weightKg: 83 })?.category).toBe('A');
  });

  it('holds a light rider below A until zFTP reaches 250 W', () => {
    const light = zwiftCategory({ zftp: 245, weightKg: 55 });
    expect(light?.category).toBe('B');
    expect(light?.nextUp).toMatchObject({ category: 'A', zftpWatts: 250 });
  });

  it('counts only zFTP when zMAP is missing, and D below C', () => {
    expect(zwiftCategory({ zftp: 200, weightKg: 83 })).toMatchObject({ category: 'D', zmapWkg: undefined, nextUp: { category: 'C' } });
  });

  it('is undefined with neither metric', () => {
    expect(zwiftCategory({ weightKg: 83 })).toBeUndefined();
  });
});

describe('zwiftCategoryTable', () => {
  it('lays out A+…D around a B rider, closest A on the smaller gap', () => {
    expect(zwiftCategoryTable({ zftp: 337, zmap: 396, weightKg: 80.7 })).toEqual([
      { category: 'A+', rule: 'zFTP ≥ 4.6 W/kg and ≥ 300 W', zftpWatts: 372, zmapWatts: undefined, state: 'above', gap: { watts: 35, metric: 'zftp' } },
      {
        category: 'A',
        rule: 'zMAP ≥ 5.1 W/kg, or zFTP ≥ 4.2 W/kg and ≥ 250 W',
        zftpWatts: 339,
        zmapWatts: 412,
        state: 'closest',
        gap: { watts: 2, metric: 'zftp' },
      },
      { category: 'B', rule: 'zMAP ≥ 4.1 W/kg, or zFTP ≥ 3.36 W/kg and ≥ 200 W', zftpWatts: 272, zmapWatts: 331, state: 'current' },
      { category: 'C', rule: 'zMAP ≥ 3.2 W/kg, or zFTP ≥ 2.625 W/kg and ≥ 150 W', zftpWatts: 212, zmapWatts: 259, state: 'met' },
      { category: 'D', rule: 'Below C', state: 'met' },
    ]);
  });

  it('uses the zMAP gap when it is smaller, and only known metrics', () => {
    const rows = zwiftCategoryTable({ zftp: 300, zmap: 420, weightKg: 83 })!;
    expect(rows.find((r) => r.category === 'A')).toMatchObject({ state: 'closest', gap: { watts: 4, metric: 'zmap' } });
    const zmapOnly = zwiftCategoryTable({ zmap: 250, weightKg: 83 })!;
    expect(zmapOnly.find((r) => r.category === 'A+')).not.toHaveProperty('gap');
    expect(zmapOnly.find((r) => r.category === 'D')?.state).toBe('current');
  });

  it('is undefined with neither metric', () => {
    expect(zwiftCategoryTable({ weightKg: 83 })).toBeUndefined();
  });
});
