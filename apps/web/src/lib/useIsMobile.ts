import { useSyncExternalStore } from 'react';

/** The same breakpoint as the `mobile:` variant in styles.css. */
const QUERY = '(width < 800px)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** Below 800 px: for layouts that differ in structure, not just styling (the calendar agenda, sheets). */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
}
