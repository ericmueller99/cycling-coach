import { foodAsLoggable, recipeTotals, roundTo } from '@cycling-coach/core';
import type { Food, FoodLibrary, Recipe, RecipeIngredient, RecipeInput } from '@cycling-coach/shared';
import { useId, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { TrashIcon } from '../../components/icons';
import { Button, ErrorNote, Field, Stepper, inputCls } from '../../components/ui';
import { fmtG, fmtKcal } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { ItemSearch } from './ItemSearch';
import { PortionRow } from './PortionRow';

/**
 * Recipe builder: ingredients from the user's foods at any amount and unit, makes
 * N servings, optional finished weight so a batch can be logged by the gram. Totals are computed
 * from the foods as they are now, so editing an ingredient food updates the recipe.
 */
export function RecipeEditor({
  lib,
  today,
  recipe,
  onClose,
  onSaved,
}: {
  lib: FoodLibrary;
  today: string;
  recipe?: Recipe | undefined;
  onClose: () => void;
  onSaved: (r: Recipe, log: boolean) => void;
}) {
  const id = useId();
  const m = useFoodMutations();
  const [name, setName] = useState(recipe?.name ?? '');
  const [servings, setServings] = useState(recipe?.servings ?? 2);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>(recipe?.ingredients ?? []);
  const [finished, setFinished] = useState(recipe?.finishedGrams ? String(recipe.finishedGrams) : '');
  const [notes, setNotes] = useState(recipe?.notes ?? '');
  /** One step per line (coach recipes come with them). */
  const [steps, setSteps] = useState((recipe?.steps ?? []).join('\n'));
  const stepList = steps.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30);
  const [aliases, setAliases] = useState(recipe?.aliases.join(', ') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Staples saved from the ingredient search while the library refetches.
  const [extraFoods, setExtraFoods] = useState<Food[]>([]);

  const foodsById = useMemo(() => new Map([...lib.foods, ...extraFoods].map((f) => [f.id, f])), [lib.foods, extraFoods]);
  const totals = useMemo(() => recipeTotals({ ingredients, servings }, foodsById), [ingredients, servings, foodsById]);
  const finishedG = Number(finished) > 0 ? Number(finished) : undefined;
  const totalG = finishedG ?? totals.rawGrams;

  const input = (): RecipeInput | null => {
    if (!name.trim()) return setError('Give the recipe a name.'), null;
    if (!ingredients.length) return setError('Add at least one ingredient.'), null;
    return {
      name: name.trim(),
      servings,
      ingredients,
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
      ...(finishedG ? { finishedGrams: finishedG } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(stepList.length ? { steps: stepList } : {}),
    };
  };

  const save = (log: boolean) => {
    const body = input();
    if (!body) return;
    setError(null);
    const fail = (e: unknown) => setError(errorMessage(e));
    if (recipe) {
      const unset = [...(!finishedG && recipe.finishedGrams ? (['finishedGrams'] as const) : []), ...(!body.notes && recipe.notes ? (['notes'] as const) : []), ...(!body.steps && recipe.steps?.length ? (['steps'] as const) : [])];
      m.updateRecipe.mutate({ id: recipe.id, patch: { ...body, ...(unset.length ? { unset } : {}) } }, { onSuccess: (r) => onSaved(r, log), onError: fail });
    } else m.createRecipe.mutate(body, { onSuccess: (r) => onSaved(r, log), onError: fail });
  };

  const busy = m.createRecipe.isPending || m.updateRecipe.isPending;
  const per = totals.perServing;
  return (
    <Dialog
      title={recipe ? 'Edit recipe' : 'New recipe'}
      width={980}
      tall
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            {recipe &&
              (confirmDelete ? (
                <>
                  <span className="text-[13px] text-muted">Remove this recipe? Past logs keep it.</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => m.archiveRecipe.mutate(recipe.id, { onSuccess: onClose, onError: (e) => setError(errorMessage(e)) })}>
                    Remove
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" aria-label="Remove recipe" onClick={() => setConfirmDelete(true)}>
                  <TrashIcon />
                </Button>
              ))}
            <span className="grow" />
            <Button disabled={busy} onClick={() => save(false)}>
              Save recipe
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => save(true)}>
              Save &amp; log a serving
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-5 desktop:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Recipe name" htmlFor={`${id}-name`} className="min-w-56 flex-auto">
              <input id={`${id}-name`} value={name} placeholder="Overnight oats" onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-muted">Makes</span>
              <div className="flex items-center gap-2">
                <Stepper label="servings" value={servings} step={1} min={1} onChange={(v) => setServings(Math.max(1, v))} />
                <span className="text-[13px] text-muted">servings</span>
              </div>
            </div>
          </div>
          <section aria-label="Ingredients" className="flex flex-col">
            <div className="text-[13px] font-semibold">Ingredients</div>
            {ingredients.map((ing, i) => {
              const food = foodsById.get(ing.foodId);
              return (
                <PortionRow
                  key={`${ing.foodId}:${i}`}
                  item={food ? foodAsLoggable(food) : undefined}
                  name="Missing food"
                  portion={{ quantity: ing.quantity, unit: ing.unit }}
                  onChange={(p) => setIngredients(ingredients.map((x, j) => (j === i ? { ...x, ...p } : x)))}
                  onRemove={() => setIngredients(ingredients.filter((_, j) => j !== i))}
                />
              );
            })}
            {!ingredients.length && <div className="py-2 text-[13px] text-muted">No ingredients yet.</div>}
          </section>
          <ItemSearch
            lib={lib}
            today={today}
            kinds={['food']}
            placeholder="Add ingredient from your foods…"
            onPick={(item, p) => setIngredients([...ingredients, { foodId: item.id, quantity: p.quantity, unit: p.unit }])}
            addNew={{
              target: 'recipe',
              onSaved: (food, p, add) => {
                setExtraFoods([...extraFoods, food]);
                if (add) setIngredients([...ingredients, { foodId: food.id, quantity: p.quantity, unit: p.unit }]);
              },
            }}
          />
          <div className="grid grid-cols-2 gap-3 mobile:grid-cols-1">
            <Field label={<>Finished weight <span className="font-normal">· optional</span></>} htmlFor={`${id}-fin`} hint="Lets you log by weight, e.g. 250 g of the batch.">
              <div className="flex items-center gap-2">
                <input id={`${id}-fin`} inputMode="decimal" value={finished} placeholder={totals.rawGrams ? String(Math.round(totals.rawGrams)) : 'e.g. 620'} onChange={(e) => setFinished(e.target.value)} className={`${inputCls} w-28 font-mono`} />
                <span className="text-[13px] text-muted">g</span>
              </div>
            </Field>
            <Field label={<>Also find it as <span className="font-normal">· optional</span></>} htmlFor={`${id}-al`}>
              <input id={`${id}-al`} value={aliases} placeholder="oats, my oats" onChange={(e) => setAliases(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label={<>Notes <span className="font-normal">· optional</span></>} htmlFor={`${id}-notes`}>
            <input id={`${id}-notes`} value={notes} placeholder="Swaps, storage…" onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <Field label={<>Steps <span className="font-normal">· optional, one per line</span></>} htmlFor={`${id}-steps`}>
            <textarea id={`${id}-steps`} rows={Math.min(10, Math.max(3, stepList.length + 1))} value={steps} placeholder={'Cook the rice.\nSear the chicken.'} onChange={(e) => setSteps(e.target.value)} className={`${inputCls} h-auto py-2`} />
          </Field>
        </div>
        <aside className="flex h-fit flex-col gap-3 rounded-[12px] border border-line bg-surface-alt p-4 desktop:sticky desktop:top-0">
          <div className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Per serving</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[34px] leading-none font-semibold">{fmtKcal(per.kcal)}</span>
            <span className="text-muted">kcal</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['Protein', per.protein],
                ['Carbs', per.carbs],
                ['Fat', per.fat],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="rounded-lg bg-surface-2 py-1.5">
                <div className="text-[11px] text-muted">{l}</div>
                <div className="font-mono text-[13px] font-semibold">{fmtG(v)} g</div>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-divider pt-2.5 text-[13px]">
            <span className="text-muted">Whole recipe</span>
            <span className="font-mono">
              {fmtKcal(totals.total.kcal)} kcal{totalG ? ` · ${Math.round(totalG)} g` : ''}
            </span>
          </div>
          {finishedG && <div className="text-xs text-muted">1 serving ≈ {fmtG(roundTo(finishedG / servings, 1))} g of the finished batch.</div>}
          {totals.problems.length > 0 && <div className="text-xs text-danger">{totals.problems.length} ingredient(s) can't be counted — check their units.</div>}
        </aside>
      </div>
    </Dialog>
  );
}
