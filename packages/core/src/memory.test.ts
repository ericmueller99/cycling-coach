import { describe, expect, it } from 'vitest';
import { activeShortTerm, checkUntil, isExpired, needsReview, REVIEW_AFTER_DAYS, visibleMemories } from './memory';
import { addDays } from './dates';

describe('short-term expiry', () => {
  const note = { until: '2026-11-11' };

  it('keeps a note through its date and the day after, then forgets it', () => {
    expect(isExpired(note, '2026-11-11')).toBe(false);
    expect(isExpired(note, '2026-11-12')).toBe(false);
    expect(isExpired(note, '2026-11-13')).toBe(true);
  });

  it('handles the end of a month', () => {
    expect(isExpired({ until: '2026-11-30' }, '2026-12-01')).toBe(false);
    expect(isExpired({ until: '2026-11-30' }, '2026-12-02')).toBe(true);
  });

  it('never expires a long-term note', () => {
    expect(isExpired({}, '2099-01-01')).toBe(false);
  });

  it('separates what the coach sees from what the athlete sees', () => {
    const long: { id: string; until?: string } = { id: 'long' };
    const live = { id: 'live', until: '2026-11-11' };
    const gone = { id: 'gone', until: '2026-11-01' };
    expect(activeShortTerm([long, live, gone], '2026-11-05')).toEqual([live]);
    expect(visibleMemories([long, live, gone], '2026-11-05')).toEqual([long, live]);
  });
});

describe('needsReview', () => {
  const createdAt = '2026-01-01T12:00:00.000Z';
  const due = addDays('2026-01-01', REVIEW_AFTER_DAYS);

  it('asks once a long-term note has gone unlooked at for long enough', () => {
    expect(needsReview({ createdAt }, addDays(due, -1))).toBe(false);
    expect(needsReview({ createdAt }, due)).toBe(true);
  });

  it('counts from the last review', () => {
    expect(needsReview({ createdAt, reviewedAt: '2026-06-01T00:00:00.000Z' }, due)).toBe(false);
  });

  it('never asks about a short-term note', () => {
    expect(needsReview({ createdAt, until: '2099-01-01' }, due)).toBe(false);
  });
});

describe('checkUntil', () => {
  const today = '2026-11-04';

  it('accepts today and dates up to a year out', () => {
    expect(checkUntil(today, today)).toBeNull();
    expect(checkUntil('2027-11-04', today)).toBeNull();
  });

  it('refuses a past date, a far-off date and a date that does not exist', () => {
    expect(checkUntil('2026-11-03', today)).toMatch(/passed/);
    expect(checkUntil('2027-11-05', today)).toMatch(/a year/);
    expect(checkUntil('2027-02-30', today)).toMatch(/real date/);
    expect(checkUntil('2026-13-01', today)).toMatch(/real date/);
  });
});
