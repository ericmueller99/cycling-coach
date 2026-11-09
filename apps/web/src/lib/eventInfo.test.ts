import { describe, expect, it } from 'vitest';
import { estimateText, eventChipMeta, eventHref, eventLinkText, eventWhen, untilLabel } from './eventInfo';

describe('event display (DECISIONS #98)', () => {
  it('says how far off an event is', () => {
    expect(untilLabel('2027-09-11', '2026-11-07')).toBe('in 44 weeks');
    expect(untilLabel('2026-11-17', '2026-11-07')).toBe('in 10 days');
    expect(untilLabel('2026-11-08', '2026-11-07')).toBe('tomorrow');
    expect(untilLabel('2026-11-07', '2026-11-07')).toBe('today');
    expect(untilLabel('2026-11-01', '2026-11-07')).toBe('');
  });

  it('writes the panel line and the chip meta the way the mockups do', () => {
    expect(eventWhen({ date: '2027-09-11', startTime: '07:00' }, '2026-11-07')).toBe('Sat Sep 11, 2027 · 7:00 AM · in 44 weeks');
    expect(eventWhen({ date: '2026-11-17', startTime: '18:30' }, '2026-11-07')).toBe('Tue Nov 17, 2026 · 6:30 PM · in 10 days');
    expect(eventChipMeta({ eventInfo: { type: 'gran_fondo', distanceKm: 142, ascentM: 2350 }, startTime: '07:00' })).toBe('142 km · 2,350 m · 7:00');
    expect(eventChipMeta({ eventInfo: { type: 'criterium', distanceKm: 40 }, startTime: '18:30' })).toBe('40 km · 18:30');
    expect(eventChipMeta({ eventInfo: { type: 'gravel', distanceKm: 102, ascentM: 1100 } })).toBe('102 km · 1,100 m');
  });

  it('marks every time as an estimate, and makes links clickable', () => {
    expect(estimateText(330)).toBe('~5 h 30');
    expect(estimateText(undefined)).toBe('');
    expect(eventHref('coastrangefondo.example')).toBe('https://coastrangefondo.example');
    expect(eventHref('http://a.example/x')).toBe('http://a.example/x');
    expect(eventLinkText('https://coastrangefondo.example/')).toBe('coastrangefondo.example');
  });
});
