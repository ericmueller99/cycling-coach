import type { RecipeShare } from '@cycling-coach/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../../lib/api';
import { recipeKeys, useRecipeShareMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { ShareIcon } from '../icons';
import { Button, ErrorNote } from '../ui';

/**
 * Share a recipe by link (DECISIONS #48). Anyone with the link can read it — no sign-in — and it
 * always shows the recipe as it is now. On a phone this opens the share sheet (Messages…);
 * elsewhere the link is copied. "Turn off link" stops it working; sharing again makes a new one.
 */

type Outcome = 'shared' | 'copied' | 'show';

async function deliver(title: string, url: string): Promise<Outcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'shared';
      // NotAllowedError: Safari wants a fresh tap after the link was created — show it instead.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'show';
  }
}

export function ShareButton({
  recipeId,
  prepare,
  name,
  share,
  size = 'sm',
  disabled,
  forServings,
}: {
  /** The Library recipe — or `prepare`, which saves a coach draft first and returns its id. */
  recipeId?: string | undefined;
  prepare?: (() => Promise<string>) | undefined;
  name: string;
  share: RecipeShare | null | undefined;
  size?: 'sm' | 'md';
  disabled?: boolean | undefined;
  /** "Cooking for N" on screen — the link opens at that count (`?for=N`). */
  forServings?: number | undefined;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const make = useMutation({
    mutationFn: async () => {
      if (share) return share;
      const id = recipeId ?? (await prepare!());
      const s = await unwrap(await api.api.food.recipes[':id'].share.$post({ param: { id } }));
      void qc.invalidateQueries({ queryKey: recipeKeys.detail(id) });
      return s;
    },
  });
  const go = async () => {
    setNote(null);
    setShown(null);
    const s = await make.mutateAsync().catch(() => null);
    if (!s) return;
    const url = forServings ? `${s.url}?for=${forServings}` : s.url;
    const o = await deliver(name, url);
    if (o === 'copied') setNote('Link copied');
    if (o === 'show') setShown(url);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size={size === 'sm' ? 'sm' : 'md'} disabled={disabled || make.isPending} onClick={() => void go()}>
        <ShareIcon /> {make.isPending ? 'Making link…' : 'Share'}
      </Button>
      {note && (
        <span role="status" className="text-xs text-success">
          {note}
        </span>
      )}
      {shown && (
        <input readOnly aria-label="Share link" value={shown} onFocus={(e) => e.currentTarget.select()} className="w-56 rounded-lg border border-line-strong bg-surface px-2 py-1 font-mono text-xs" />
      )}
      {make.error && <ErrorNote>{errorMessage(make.error)}</ErrorNote>}
    </span>
  );
}

/** The live link, with Copy and Turn off link. */
export function SharePanel({ recipeId, share }: { recipeId: string; share: RecipeShare }) {
  const m = useRecipeShareMutations(recipeId);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface-alt p-3">
      <div className="text-[13px] text-muted">Anyone with this link can view the recipe — no sign-in.</div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          aria-label="Share link"
          value={share.url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-auto rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-xs text-ink"
        />
        <Button size="sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" disabled={m.unshare.isPending} onClick={() => m.unshare.mutate()}>
          Turn off link
        </Button>
      </div>
      {m.unshare.error && <ErrorNote>{errorMessage(m.unshare.error)}</ErrorNote>}
    </div>
  );
}
