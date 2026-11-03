import { slotForTime } from '@cycling-coach/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AppBar } from '../../components/AppBar';
import { ChevronRight, ExpandIcon, PencilIcon } from '../../components/icons';
import { CookMode } from '../../components/recipe/CookMode';
import { RecipeBody } from '../../components/recipe/RecipeBody';
import { ShareButton, SharePanel } from '../../components/recipe/ShareRecipe';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { nowTime } from '../../lib/food';
import { useFoodLibrary, useRecipeDetail } from '../../lib/foodQueries';
import { errorMessage, useDashboard } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { useFoodFlows } from '../food/flows';
import { RecipeEditor } from '../food/RecipeEditor';

/**
 * A Library recipe to read and cook from (DECISIONS #47): ingredients with the
 * recipe's own names, "Cooking for N" (`?for=`, display only), the method, full-screen cook mode,
 * Edit, Log a serving and a share link.
 */
export function RecipePage({ id, cookFor }: { id: string; cookFor?: number | undefined }) {
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const detail = useRecipeDetail(id);
  const lib = useFoodLibrary();
  const dashboard = useDashboard();
  const today = dashboard.data?.today ?? new Date().toISOString().slice(0, 10);
  const slot = lib.data ? slotForTime(lib.data.settings.slots, nowTime()) : 'Dinner';
  const flows = useFoodFlows({ lib: lib.data, date: today, dateLabel: 'Today', defaultSlot: slot });
  const [editing, setEditing] = useState(false);
  const [cooking, setCooking] = useState(false);

  const d = detail.data;
  const servings = cookFor ?? d?.view.servings ?? 1;
  const setServings = (n: number) =>
    void navigate({ to: '/library/recipes/$id', params: { id }, search: n === d?.view.servings ? {} : { for: n }, replace: true });

  const actions = d && (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" onClick={() => setCooking(true)}>
        <ExpandIcon /> Cook
      </Button>
      <Button onClick={() => flows.setFlow({ kind: 'log', slot, preselect: { kind: 'recipe', id } })}>Log a serving</Button>
      <ShareButton recipeId={id} name={d.view.name} share={d.share} size="md" disabled={!!d.recipe.archived} forServings={cookFor} />
      <Button variant="ghost" disabled={!lib.data} onClick={() => setEditing(true)}>
        <PencilIcon /> Edit
      </Button>
    </div>
  );

  const body = detail.isPending ? (
    <Spinner />
  ) : detail.error || !d ? (
    <ErrorNote>{errorMessage(detail.error)}</ErrorNote>
  ) : (
    <div className="flex flex-col gap-5">
      {d.recipe.archived && <ErrorNote>This recipe was removed from your library.</ErrorNote>}
      {mobile && actions}
      {d.share && <SharePanel recipeId={id} share={d.share} />}
      <RecipeBody view={d.view} servings={servings} onServings={setServings} />
    </div>
  );

  const overlays = (
    <>
      {cooking && d && <CookMode view={d.view} servings={servings} onServings={setServings} storageKey={`recipe:${id}`} onClose={() => setCooking(false)} />}
      {editing && d && lib.data && (
        <RecipeEditor
          lib={lib.data}
          today={today}
          recipe={d.recipe}
          onClose={() => setEditing(false)}
          onSaved={(r, log) => {
            setEditing(false);
            void detail.refetch();
            if (log) flows.setFlow({ kind: 'log', slot, preselect: { kind: 'recipe', id: r.id } });
          }}
        />
      )}
      {flows.element}
    </>
  );

  if (mobile) {
    return (
      <>
        <AppBar title={d?.view.name ?? 'Recipe'} subtitle="Recipe" back />
        <div className="px-4 pt-3 pb-8">{body}</div>
        {overlays}
      </>
    );
  }
  return (
    <div className="min-h-dvh">
      <header className="flex flex-col gap-2 border-b border-line px-7 pt-[18px] pb-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px] text-muted">
          <Link to="/library/$tab" params={{ tab: 'recipes' }} className="text-accent-ink">
            Recipes
          </Link>
          <ChevronRight size={14} />
          <span className="truncate">{d?.view.name ?? '…'}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 min-w-0 text-2xl font-bold">{d?.view.name ?? 'Recipe'}</h1>
          {actions}
        </div>
      </header>
      <div className="mx-auto max-w-[760px] px-7 pt-5 pb-12">{body}</div>
      {overlays}
    </div>
  );
}
