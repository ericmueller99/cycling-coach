/** Stale lazy chunks after a deploy (DECISIONS #43): reload once, silently. */
const RELOADED_AT = 'cc:chunk-reload-at';

/**
 * A lazy chunk (the barcode scanner) from the previous build is gone after a deploy. Vite fires
 * `vite:preloadError`; reload once to pick up the new build, but never loop.
 */
export function reloadOnStaleChunks(): void {
  window.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOADED_AT)) || 0;
    } catch {
      // Storage blocked: fall through and reload once anyway.
    }
    if (Date.now() - last < 30_000) return; // Already tried; let the error surface.
    try {
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    } catch {
      // ignore
    }
    event.preventDefault();
    window.location.reload();
  });
}
