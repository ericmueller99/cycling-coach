import { LAND_IDLE_MINUTES } from '@cycling-coach/core';
import { useEffect, useRef } from 'react';

const KEY = 'coach-away';
const TICK_MS = 60_000;

/** What was on screen when the page went out of sight. In sessionStorage, so it outlives the page itself. */
interface AwayMark {
  at: number;
  threadId: string;
  latestAt: string;
}

function write(mark: AwayMark) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(mark));
  } catch {
    // Private windows can refuse. This is a nicety: they stay on the chat.
  }
}

/** Taken, not read, so one return acts once. */
function take(): AwayMark | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as AwayMark) : null;
  } catch {
    return null;
  }
}

interface AwayOptions {
  /** The chat on screen. */
  threadId: string | undefined;
  /** When it last changed, from the server. */
  latestAt: string | undefined;
  /** They're back on the chat they left. The caller decides if that means a new one (DECISIONS #82). */
  onReturn: (away: { hiddenAt: Date; latestAt: Date }) => void;
}

/**
 * Notices the athlete coming back to a page they left open. Phones usually just show the page again,
 * but they can also discard it, which comes back as a fresh load with only the mark to say it was
 * away. A reload writes a mark too, seconds old, which is why it stays put. A sleeping laptop may send
 * no events at all, but its timers stop, so the gap shows on the next tick.
 */
export function useAwayReturn(options: AwayOptions) {
  const current = useRef(options);
  current.current = options;

  useEffect(() => {
    let lastTick = Date.now();
    const here = (at: number): AwayMark | null => {
      const { threadId, latestAt } = current.current;
      return threadId && latestAt ? { at, threadId, latestAt } : null;
    };
    const leave = () => {
      const mark = here(Date.now());
      if (mark) write(mark);
    };
    const back = (fallback?: AwayMark | null) => {
      lastTick = Date.now();
      const mark = take() ?? fallback;
      if (mark && mark.threadId === current.current.threadId) current.current.onReturn({ hiddenAt: new Date(mark.at), latestAt: new Date(mark.latestAt) });
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? leave() : back());
    const onPageShow = () => back();
    const tick = setInterval(() => {
      const slept = Date.now() - lastTick >= LAND_IDLE_MINUTES * 60_000;
      if (slept && document.visibilityState === 'visible') back(here(lastTick));
      else lastTick = Date.now();
    }, TICK_MS);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', onPageShow);
    back();
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}
