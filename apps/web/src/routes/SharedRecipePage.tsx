import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { BrandTile } from '../components/BrandTile';
import { ExpandIcon } from '../components/icons';
import { useExtensions } from '../extensions';
import { CookMode } from '../components/recipe/CookMode';
import { RecipeBody } from '../components/recipe/RecipeBody';
import { Button, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { useSharedRecipe } from '../lib/foodQueries';

/**
 * `/r/:token` — a recipe someone shared (DECISIONS #48). No sign-in and no app chrome: the
 * recipe, "Cooking for N" and cook mode. Nothing here reads the viewer's account.
 */
export function SharedRecipePage({ token, cookFor }: { token: string; cookFor?: number | undefined }) {
  const navigate = useNavigate();
  const { brand, logo } = useExtensions();
  const q = useSharedRecipe(token);
  const [cooking, setCooking] = useState(false);
  const d = q.data;
  const servings = cookFor ?? d?.view.servings ?? 1;
  const setServings = (n: number) => void navigate({ to: '/r/$token', params: { token }, search: n === d?.view.servings ? {} : { for: n }, replace: true });

  const status = q.error instanceof ApiError ? q.error.status : null;
  return (
    <div className="min-h-dvh bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[760px] items-center gap-2.5 px-4 py-3">
          {logo ? (
            <BrandLogo logo={logo} alt={brand} height={34} />
          ) : (
            <>
              <BrandTile size={28} radius={8} />
              <span className="font-semibold">{brand}</span>
            </>
          )}
          {d &&<span className="ml-auto text-[13px] text-muted">Shared by {d.sharedBy}</span>}
        </div>
      </header>
      <main className="mx-auto flex max-w-[760px] flex-col gap-5 px-4 pt-5 pb-12">
        {q.isPending ? (
          <Spinner />
        ) : !d ? (
          <div className="flex flex-col gap-2 py-10 text-center">
            <h1 className="m-0 text-xl font-bold">{status === 410 ? 'This link was turned off' : status === 404 ? 'Recipe not found' : 'Couldn’t load the recipe'}</h1>
            <p className="m-0 text-muted">{status === 410 || status === 404 ? 'Ask whoever sent it for a new link.' : 'Check your connection and try again.'}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="m-0 min-w-0 text-2xl leading-tight font-bold">{d.view.name}</h1>
              <Button variant="primary" onClick={() => setCooking(true)}>
                <ExpandIcon /> Cook
              </Button>
            </div>
            <RecipeBody view={d.view} servings={servings} onServings={setServings} />
          </>
        )}
      </main>
      {cooking && d && <CookMode view={d.view} servings={servings} onServings={setServings} storageKey={`shared:${token}`} onClose={() => setCooking(false)} />}
    </div>
  );
}
