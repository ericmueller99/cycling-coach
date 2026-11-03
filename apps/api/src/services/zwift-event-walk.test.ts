import { describe, expect, it, vi } from 'vitest';
import { walkEventFeed, walkPublicFeed } from './zwift-event-walk';

const T0 = Date.parse('2026-10-31T06:00:00Z');
const at = (h: number) => new Date(T0 + h * 3600_000).toISOString();
/** A page of events `ids`, starting at hour `h`. */
const page = (ids: number[], h: number, cursor?: string) => ({ events: ids.map((id) => ({ id, h })), cursor });

function store() {
  return vi.fn(async (events: unknown[]) => {
    const evs = events as { id: number; h: number }[];
    return { ids: evs.map((e) => e.id), lastStart: evs.length ? at(Math.max(...evs.map((e) => e.h))) : undefined };
  });
}

const base = { now: () => T0, to: T0 + 7 * 24 * 3600_000, maxPages: 120, maxMs: 6 * 60_000 };

describe('walkEventFeed', () => {
  it('follows the cursor until the feed ends', async () => {
    const pages = [page([1, 2], 1, 'c1'), page([3, 4], 2, 'c2'), page([5], 3)];
    const fetchPage = vi.fn(async (_cursor: string | undefined) => pages.shift()!);
    const walk = await walkEventFeed({ ...base, fetchPage, storePage: store() });
    expect(walk).toMatchObject({ pages: 3, complete: true, through: at(3) });
    expect([...walk.ids]).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage.mock.calls.map(([c]) => c)).toEqual([undefined, 'c1', 'c2']);
  });

  it('stops once the events are past the window', async () => {
    const fetchPage = vi.fn(async (c: string | undefined) => (c ? page([3], 24 * 8, 'c2') : page([1, 2], 1, 'c1')));
    const walk = await walkEventFeed({ ...base, fetchPage, storePage: store() });
    expect(walk).toMatchObject({ pages: 2, complete: true });
  });

  it('never fetches more than the page budget', async () => {
    let n = 0;
    const fetchPage = vi.fn(async () => (n++, page([n], 1, `c${n}`)));
    const walk = await walkEventFeed({ ...base, maxPages: 5, fetchPage, storePage: store() });
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(walk).toMatchObject({ pages: 5, complete: false, stop: 'page budget' });
  });

  it('stops at the time budget', async () => {
    let t = T0;
    let n = 0;
    const fetchPage = vi.fn(async () => ((t += 2 * 60_000), n++, page([n], 1, `c${n}`)));
    const walk = await walkEventFeed({ ...base, now: () => t, fetchPage, storePage: store() });
    expect(walk.stop).toBe('time budget');
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('stops when the cursor repeats', async () => {
    const fetchPage = vi.fn(async (c: string | undefined) => (c ? page([2], 2, 'same') : page([1], 1, 'same')));
    const walk = await walkEventFeed({ ...base, fetchPage, storePage: store() });
    expect(walk).toMatchObject({ pages: 2, stop: 'feed repeated itself', complete: false });
  });

  it('stops when a page brings nothing new', async () => {
    const fetchPage = vi.fn(async (c: string | undefined) => (c ? page([1, 2], 1, 'c2') : page([1, 2], 1, 'c1')));
    const walk = await walkEventFeed({ ...base, fetchPage, storePage: store() });
    expect(walk).toMatchObject({ pages: 2, stop: 'feed repeated itself' });
  });

  it('stops at the first error without retrying, keeping what it stored', async () => {
    const storePage = store();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], 1, 'c1'))
      .mockRejectedValueOnce(Object.assign(new Error('Zwift error 429'), { status: 429 }));
    await expect(walkEventFeed({ ...base, fetchPage, storePage })).rejects.toThrow('429');
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(storePage).toHaveBeenCalledTimes(1);
  });
});

describe('walkPublicFeed', () => {
  it('pages by offset until a short page', async () => {
    const fetchPage = vi.fn(async (start: number) => (start < 400 ? Array.from({ length: 200 }, (_, i) => ({ id: start + i, h: 1 })) : [{ id: 999, h: 2 }]));
    const walk = await walkPublicFeed({ fetchPage, storePage: store(), pageSize: 200, maxPages: 5 });
    expect(fetchPage.mock.calls.map(([s]) => s)).toEqual([0, 200, 400]);
    expect(walk).toMatchObject({ pages: 3, complete: true, through: at(2) });
  });

  it('never fetches more than the page cap', async () => {
    const fetchPage = vi.fn(async (start: number) => Array.from({ length: 200 }, (_, i) => ({ id: start + i, h: 1 })));
    const walk = await walkPublicFeed({ fetchPage, storePage: store(), pageSize: 200, maxPages: 5 });
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(walk).toMatchObject({ complete: false, stop: 'page budget' });
  });
});
