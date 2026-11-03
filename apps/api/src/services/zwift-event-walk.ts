/**
 * The two page loops over Zwift's event feeds, with I/O injected so their stop conditions are
 * tested on their own (DECISIONS #29). Errors are never retried: the first failed request ends the
 * walk and propagates.
 */

export interface StoredPage {
  /** Ids of the cycling events on the page (after mapping). */
  ids: number[];
  /** Latest event start on the page, ISO. */
  lastStart?: string | undefined;
}

export interface FeedWalk {
  pages: number;
  ids: Set<number>;
  through?: string | undefined;
  /** Reached the end of the list or the window — only then can missing events be removed. */
  complete: boolean;
  /** Why a walk stopped early. */
  stop?: 'page budget' | 'time budget' | 'feed repeated itself' | undefined;
}

function track(walk: FeedWalk, stored: StoredPage) {
  for (const id of stored.ids) walk.ids.add(id);
  if (stored.lastStart && (!walk.through || stored.lastStart > walk.through)) walk.through = stored.lastStart;
}

/** The logged-in `event-feed`, by cursor, from now to `to`, within page and time budgets. */
export async function walkEventFeed(d: {
  fetchPage(cursor: string | undefined): Promise<{ events: unknown[]; cursor?: string | undefined }>;
  storePage(events: unknown[], seen: ReadonlySet<number>): Promise<StoredPage>;
  now(): number;
  to: number;
  maxPages: number;
  maxMs: number;
}): Promise<FeedWalk> {
  const walk: FeedWalk = { pages: 0, ids: new Set(), complete: false };
  const started = d.now();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    if (walk.pages >= d.maxPages) return { ...walk, stop: 'page budget' };
    if (d.now() - started > d.maxMs) return { ...walk, stop: 'time budget' };
    const page = await d.fetchPage(cursor);
    walk.pages++;
    const before = walk.ids.size;
    const stored = await d.storePage(page.events, walk.ids);
    track(walk, stored);
    if (!page.events.length || !page.cursor) return { ...walk, complete: true };
    if (stored.lastStart && Date.parse(stored.lastStart) > d.to) return { ...walk, complete: true };
    // A cursor seen before, or a page of nothing new, means the feed is going round in circles.
    if (cursors.has(page.cursor) || walk.ids.size === before) return { ...walk, stop: 'feed repeated itself' };
    cursors.add(page.cursor);
    cursor = page.cursor;
  }
}

/** The public list, by offset, `pageSize` at a time, at most `maxPages`. */
export async function walkPublicFeed(d: {
  fetchPage(start: number): Promise<unknown[]>;
  storePage(events: unknown[]): Promise<StoredPage>;
  pageSize: number;
  maxPages: number;
}): Promise<FeedWalk> {
  const walk: FeedWalk = { pages: 0, ids: new Set(), complete: false };
  while (walk.pages < d.maxPages) {
    const raw = await d.fetchPage(walk.pages * d.pageSize);
    walk.pages++;
    track(walk, await d.storePage(raw));
    if (raw.length < d.pageSize) return { ...walk, complete: true };
  }
  return { ...walk, stop: 'page budget' };
}
