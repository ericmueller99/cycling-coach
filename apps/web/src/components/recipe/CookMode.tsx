import { formatPortion } from '@cycling-coach/core';
import type { RecipeView } from '@cycling-coach/shared';
import { useEffect, useState } from 'react';
import { CheckIcon, XIcon } from '../icons';
import { ServingsPicker } from '../ServingsPicker';
import { linesFor, RecipeMeta } from './RecipeBody';
import { StepText } from './StepText';

/**
 * Full-screen cook mode (DECISIONS #47) — for following a recipe on a phone propped on the
 * counter. Big type; tap an ingredient once it's out, tap a step once it's done (the next one is
 * highlighted). The screen stays on where the browser allows it. Ticks last for the browser tab.
 */

type Ticks = { ing: number[]; steps: number[] };
const EMPTY: Ticks = { ing: [], steps: [] };

function readTicks(key: string): Ticks {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Ticks) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeTicks(key: string, t: Ticks) {
  try {
    sessionStorage.setItem(key, JSON.stringify(t));
  } catch {
    /* private mode: ticks just don't persist */
  }
}

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } };
const wakeLockSupported = () => typeof navigator !== 'undefined' && !!(navigator as WakeLockNavigator).wakeLock;

/** Keeps the screen on while `on`; re-acquired when the page comes back to the foreground. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    const wl = (navigator as WakeLockNavigator).wakeLock;
    if (!on || !wl) return;
    let lock: WakeLockSentinelLike | null = null;
    let stopped = false;
    const acquire = async () => {
      try {
        const l = await wl.request('screen');
        if (stopped) void l.release();
        else lock = l;
      } catch {
        /* denied (battery saver, not visible) — nothing to do */
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [on]);
}

export function CookMode({
  view,
  servings,
  onServings,
  storageKey,
  onClose,
}: {
  view: RecipeView;
  servings: number;
  onServings: (n: number) => void;
  /** Where the ticks are kept for this recipe. */
  storageKey: string;
  onClose: () => void;
}) {
  const key = `cook:${storageKey}`;
  const [ticks, setTicks] = useState<Ticks>(() => readTicks(key));
  const [awake, setAwake] = useState(true);
  const canWake = wakeLockSupported();
  useWakeLock(awake && canWake);

  // The page behind doesn't scroll; Escape closes.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const toggle = (list: 'ing' | 'steps', i: number) => {
    const has = ticks[list].includes(i);
    const next = { ...ticks, [list]: has ? ticks[list].filter((x) => x !== i) : [...ticks[list], i] };
    setTicks(next);
    writeTicks(key, next);
  };
  const reset = () => {
    setTicks(EMPTY);
    writeTicks(key, EMPTY);
  };

  const lines = linesFor(view, servings);
  const current = view.steps.findIndex((_, i) => !ticks.steps.includes(i));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cook ${view.name}`}
      className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[720px] items-center gap-3 px-4 py-3">
          <h1 className="m-0 min-w-0 flex-auto text-lg leading-snug font-bold">{view.name}</h1>
          <button
            type="button"
            aria-label="Close cook mode"
            onClick={onClose}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line-strong bg-surface text-ink"
          >
            <XIcon size={18} />
          </button>
        </div>
      </div>

      <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 py-5">
        <RecipeMeta view={view} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ServingsPicker value={servings} onChange={onServings} size="lg" />
          {canWake && (
            <label className="flex min-h-11 items-center gap-2 text-[14px] text-muted">
              <input type="checkbox" checked={awake} onChange={(e) => setAwake(e.target.checked)} className="h-5 w-5 accent-[var(--color-accent)]" />
              Keep screen on
            </label>
          )}
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[13px] font-semibold tracking-wide text-muted uppercase">Ingredients</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {lines.map((l, i) => {
              const on = ticks.ing.includes(i);
              return (
                <li key={i}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle('ing', i)}
                    className={`flex min-h-[52px] w-full items-center gap-3 rounded-[12px] border px-3.5 py-2 text-left text-[17px] ${on ? 'border-line bg-surface-2 text-muted line-through' : 'border-line-strong bg-surface text-ink'}`}
                  >
                    <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-md border ${on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'}`}>
                      {on && <CheckIcon size={14} />}
                    </span>
                    <span className="w-[92px] flex-none font-mono text-[15px] font-semibold">{formatPortion(l.quantity, l.unit)}</span>
                    <span className="min-w-0">{l.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {view.toTaste.length > 0 && (
            <div className="text-[15px] text-muted">
              <span className="font-semibold text-ink">To taste:</span> {view.toTaste.join(', ')}
            </div>
          )}
        </section>

        {view.steps.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-[13px] font-semibold tracking-wide text-muted uppercase">Method</h2>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {view.steps.map((s, i) => {
                const done = ticks.steps.includes(i);
                const now = i === current;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      aria-pressed={done}
                      aria-current={now ? 'step' : undefined}
                      onClick={() => toggle('steps', i)}
                      className={`flex w-full gap-3.5 rounded-[14px] border p-4 text-left text-[18px] leading-relaxed ${
                        done ? 'border-line bg-surface-2 text-muted' : now ? 'border-2 border-accent bg-surface text-ink shadow-sm' : 'border-line-strong bg-surface text-ink'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 flex-none items-center justify-center rounded-full font-mono text-[15px] font-semibold ${done ? 'bg-accent text-on-accent' : 'bg-accent-tint-2 text-accent-ink'}`}
                      >
                        {done ? <CheckIcon size={16} /> : i + 1}
                      </span>
                      <span className="min-w-0 [&_strong]:font-semibold">
                        <StepText text={s} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <div className="flex items-center justify-between gap-3 pb-6">
          {current === -1 && view.steps.length > 0 ? <span className="font-semibold text-success">All done — enjoy.</span> : <span />}
          {(ticks.ing.length > 0 || ticks.steps.length > 0) && (
            <button type="button" onClick={reset} className="min-h-11 rounded-lg border-0 bg-transparent px-2 text-[14px] text-muted underline">
              Clear ticks
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
