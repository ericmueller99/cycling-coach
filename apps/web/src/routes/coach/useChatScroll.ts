import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Space between the sticky header and the message anchored under it, and under the latest line. */
const GAP = 16;

const motion = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/**
 * Where the Coach page scrolls (DECISIONS #84). Sending moves the message up under the header once,
 * and nothing scrolls after that: the reply grows down the page from where the eye already is, and
 * "Latest" is there when it runs past the composer. Opening a thread lands on its last message.
 *
 * The window is the scroller. Messages carry `data-user-row`, and `endRef` sits after the last one.
 */
export function useChatScroll({ threadId, loaded, turnStart, streaming }: { threadId: string | undefined; loaded: boolean; turnStart: number | undefined; streaming: boolean }) {
  const conversationRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /** A message was just sent, and its bubble is about to render. */
  const pending = useRef(false);
  /** The thread the page is anchored in, which it leaves alone until a new message or thread. */
  const anchored = useRef<string | null>(null);
  const stopSettling = useRef(() => {});

  /** The last line just above the composer, which is not the page's end when the right rail wraps below. */
  const toEnd = useCallback((behavior: ScrollBehavior = 'auto') => {
    const end = endRef.current;
    const dock = dockRef.current;
    if (!end || !dock) return;
    window.scrollTo({ top: Math.max(0, window.scrollY + end.getBoundingClientRect().bottom + GAP - dock.getBoundingClientRect().top), behavior });
  }, []);

  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    const dock = dockRef.current;
    if (!pending.current || !turnStart || !conversation || !dock) return;
    const row = [...conversation.querySelectorAll('[data-user-row]')].at(-1);
    if (!row) return;
    pending.current = false;
    anchored.current = threadId ?? null;
    stopSettling.current();
    const header = conversation.parentElement?.firstElementChild?.getBoundingClientRect().height ?? 0;
    const top = row.getBoundingClientRect().top;
    // Room for the message to reach the header. It stays after the turn, so the page's height holds
    // while the live reply swaps for the stored one and cards shrink.
    conversation.style.minHeight = `${top - conversation.getBoundingClientRect().top + dock.getBoundingClientRect().top - header - GAP}px`;
    window.scrollTo({ top: window.scrollY + top - header - GAP, behavior: motion() });
  }, [turnStart, threadId]);

  useEffect(() => {
    if (pending.current || anchored.current === threadId) return;
    anchored.current = null;
    if (conversationRef.current) conversationRef.current.style.minHeight = '';
    toEnd();
  }, [threadId, toEnd]);

  // Opening a thread lands on the latest message. Workout charts and proposal cards load after the
  // first scroll and push the bottom down, so stay pinned while they settle — unless the user scrolls.
  useEffect(() => {
    const el = conversationRef.current;
    if (!el || !loaded || pending.current || anchored.current === threadId) return;
    const observer = new ResizeObserver(() => toEnd());
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const ev of ['wheel', 'touchmove', 'keydown'] as const) window.removeEventListener(ev, stop);
    };
    const timer = setTimeout(stop, 2000);
    for (const ev of ['wheel', 'touchmove', 'keydown'] as const) window.addEventListener(ev, stop, { passive: true });
    observer.observe(el);
    stopSettling.current = stop;
    toEnd();
    return stop;
  }, [threadId, loaded, toEnd]);

  // The reply's end is below the composer. Measured against the composer, which covers the page there.
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const end = endRef.current;
    const dock = dockRef.current;
    if (!end || !dock) return;
    let seen: IntersectionObserver | undefined;
    const watch = () => {
      seen?.disconnect();
      const covered = Math.max(0, Math.round(window.innerHeight - dock.getBoundingClientRect().top));
      seen = new IntersectionObserver(
        ([entry]) => {
          if (entry) setBelow(!entry.isIntersecting && entry.boundingClientRect.top > (entry.rootBounds?.bottom ?? 0));
        },
        { rootMargin: `0px 0px -${covered}px 0px` },
      );
      seen.observe(end);
    };
    const resized = new ResizeObserver(watch);
    resized.observe(dock);
    window.addEventListener('resize', watch);
    return () => {
      seen?.disconnect();
      resized.disconnect();
      window.removeEventListener('resize', watch);
    };
  }, []);

  // Only for words the athlete hasn't reached yet, not for every scroll up through an old chat.
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (streaming) setUnread(true);
    else if (!below) setUnread(false);
  }, [streaming, below]);
  useEffect(() => setUnread(false), [threadId]);

  return {
    conversationRef,
    dockRef,
    endRef,
    /** Call as a message goes: the page anchors on it when it renders. */
    anchorNext: useCallback(() => {
      pending.current = true;
    }, []),
    showLatest: unread && below,
    toLatest: useCallback(() => toEnd(motion()), [toEnd]),
  };
}
