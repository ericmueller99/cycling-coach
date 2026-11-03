import { slotForTime } from '@cycling-coach/core';
import type { Meal, Recipe } from '@cycling-coach/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { AppBar, IconButton } from '../../components/AppBar';
import { PlusIcon } from '../../components/icons';
import { SectionTabs } from '../../components/SectionTabs';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { nowTime } from '../../lib/food';
import { useFoodLibrary } from '../../lib/foodQueries';
import { errorMessage, useDashboard, useWorkouts } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { useFoodFlows } from '../food/flows';
import { MealEditor } from '../food/MealEditor';
import { RecipeEditor } from '../food/RecipeEditor';
import { FoodsTab } from './FoodsTab';
import { MealsTab } from './MealsTab';
import { RecipesTab } from './RecipesTab';
import { NEW_WORKOUT_PROMPT, WorkoutsTab } from './WorkoutsTab';

export const LIBRARY_TABS = ['workouts', 'foods', 'recipes', 'meals'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];
const NEW_LABEL: Record<LibraryTab, string> = { workouts: 'Build with coach', foods: 'New food', recipes: 'New recipe', meals: 'New meal' };

/**
 * Library: everything the athlete reuses — Zwift workouts, foods, recipes, meals. Logging
 * and scheduling happen on the calendar; the food dialogs open here too. Desktop is locked to the
 * viewport (the list scrolls); phones scroll the page.
 */
export function LibraryPage({ tab }: { tab: LibraryTab }) {
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const dashboard = useDashboard();
  const workouts = useWorkouts();
  const lib = useFoodLibrary();
  const today = dashboard.data?.today ?? new Date().toISOString().slice(0, 10);
  const slot = lib.data ? slotForTime(lib.data.settings.slots, nowTime()) : 'Breakfast';
  const flows = useFoodFlows({ lib: lib.data, date: today, dateLabel: 'Today', defaultSlot: slot });
  const [recipe, setRecipe] = useState<Recipe | 'new' | null>(null);
  const [meal, setMeal] = useState<Meal | 'new' | null>(null);

  const count = (xs: { archived?: boolean | undefined }[] | undefined) => xs?.filter((x) => !x.archived).length;
  const tabs = [
    { key: 'workouts' as const, label: 'Workouts', count: workouts.data?.length },
    { key: 'foods' as const, label: 'Foods', count: count(lib.data?.foods) },
    { key: 'recipes' as const, label: 'Recipes', count: count(lib.data?.recipes) },
    { key: 'meals' as const, label: 'Meals', count: count(lib.data?.meals) },
  ];

  const create = () => {
    if (tab === 'workouts') void navigate({ to: '/', search: { new: true, prompt: NEW_WORKOUT_PROMPT } });
    else if (tab === 'foods') flows.newFood('', slot);
    else if (tab === 'recipes') setRecipe('new');
    else setMeal('new');
  };

  const actions: ReactNode =
    tab === 'foods' ? (
      <>
        <Button onClick={() => flows.staples('', slot)}>Add a staple</Button>
        <Button onClick={() => flows.photo(slot)}>From label / screenshot</Button>
        <Button variant="primary" onClick={create}>
          <PlusIcon /> New food
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={create}>
        {tab !== 'workouts' && <PlusIcon />} {NEW_LABEL[tab]}
      </Button>
    );

  let body: ReactNode;
  if (tab === 'workouts') {
    body = dashboard.data ? <WorkoutsTab mobile={mobile} today={today} ftp={dashboard.data.snapshot.ftpZwift} /> : <Spinner />;
  } else if (lib.isPending) {
    body = <Spinner />;
  } else if (lib.error || !lib.data) {
    body = <ErrorNote>{errorMessage(lib.error)}</ErrorNote>;
  } else if (tab === 'foods') {
    body = <FoodsTab lib={lib.data} flows={flows} today={today} slot={slot} mobile={mobile} />;
  } else if (tab === 'recipes') {
    body = <RecipesTab lib={lib.data} flows={flows} slot={slot} today={today} onEdit={setRecipe} />;
  } else {
    body = <MealsTab lib={lib.data} flows={flows} slot={slot} mobile={mobile} onEdit={setMeal} />;
  }
  // The Foods table and its detail panel scroll on their own; the other tabs scroll as one list.
  const selfScrolling = tab === 'foods' && !mobile && !!lib.data;

  const dialogs = (
    <>
      {recipe && lib.data && (
        <RecipeEditor
          lib={lib.data}
          today={today}
          recipe={recipe === 'new' ? undefined : recipe}
          onClose={() => setRecipe(null)}
          onSaved={(r, log) => {
            setRecipe(null);
            if (log) flows.setFlow({ kind: 'log', slot, preselect: { kind: 'recipe', id: r.id } });
          }}
        />
      )}
      {meal && lib.data && (
        <MealEditor
          lib={lib.data}
          today={today}
          meal={meal === 'new' ? undefined : meal}
          onClose={() => setMeal(null)}
          onSaved={(m, log) => {
            setMeal(null);
            if (log) flows.setFlow({ kind: 'log', slot: m.slot ?? slot, preselect: { kind: 'meal', id: m.id } });
          }}
        />
      )}
      {flows.element}
    </>
  );

  if (mobile) {
    return (
      <>
        <AppBar
          title="Library"
          actions={
            <IconButton aria-label={NEW_LABEL[tab]} onClick={create}>
              <PlusIcon size={20} />
            </IconButton>
          }
        >
          <SectionTabs label="Library sections" base="/library/$tab" tabs={tabs} active={tab} mobile />
        </AppBar>
        <div className="px-4 pt-3 pb-5">{body}</div>
        {dialogs}
      </>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <header className="flex flex-none flex-col gap-2.5 border-b border-line px-7 pt-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="m-0 text-xl font-bold">Library</h1>
            <div className="text-[13px] text-muted">Everything you reuse. Log and schedule from the calendar.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
        <SectionTabs label="Library sections" base="/library/$tab" tabs={tabs} active={tab} mobile={false} />
      </header>
      {selfScrolling ? body : <div className="min-h-0 flex-1 overflow-auto px-7 pt-4 pb-9">{body}</div>}
      {dialogs}
    </div>
  );
}
