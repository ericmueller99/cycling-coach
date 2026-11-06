import { describe, expect, it } from 'vitest';
import { sessionsInSpan, spanPosition, timeOffOn } from './time-off';

const span = { startDate: '2026-11-09', endDate: '2026-11-11' };

describe('timeOffOn', () => {
  it('includes the first and last day', () => {
    expect(timeOffOn([span], '2026-11-08')).toEqual([]);
    expect(timeOffOn([span], '2026-11-09')).toEqual([span]);
    expect(timeOffOn([span], '2026-11-11')).toEqual([span]);
    expect(timeOffOn([span], '2026-11-12')).toEqual([]);
  });

  it('finds both of two entries that overlap', () => {
    const sick = { startDate: '2026-11-10', endDate: '2026-11-10' };
    expect(timeOffOn([span, sick], '2026-11-10')).toEqual([span, sick]);
  });
});

it('says where a day sits in an entry', () => {
  expect(spanPosition(span, '2026-11-09')).toBe('start');
  expect(spanPosition(span, '2026-11-10')).toBe('middle');
  expect(spanPosition(span, '2026-11-11')).toBe('end');
  expect(spanPosition({ startDate: '2026-11-09', endDate: '2026-11-09' }, '2026-11-09')).toBe('single');
});

describe('sessionsInSpan', () => {
  const on = (date: string, status: 'planned' | 'done' | 'skipped' | 'missed' = 'planned') => ({ date, status });

  it('finds planned sessions on the first and last day, and none outside', () => {
    const events = [on('2026-11-08'), on('2026-11-09'), on('2026-11-11'), on('2026-11-12')];
    expect(sessionsInSpan(events, '2026-11-09', '2026-11-11', '2026-11-01').map((e) => e.date)).toEqual(['2026-11-09', '2026-11-11']);
  });

  it('leaves out what already happened or was already dropped', () => {
    const events = [on('2026-11-09', 'done'), on('2026-11-10', 'skipped'), on('2026-11-10', 'missed')];
    expect(sessionsInSpan(events, '2026-11-09', '2026-11-11', '2026-11-01')).toEqual([]);
  });

  it('counts today but not a day already over', () => {
    const events = [on('2026-11-09'), on('2026-11-10')];
    expect(sessionsInSpan(events, '2026-11-09', '2026-11-11', '2026-11-10').map((e) => e.date)).toEqual(['2026-11-10']);
  });
});
