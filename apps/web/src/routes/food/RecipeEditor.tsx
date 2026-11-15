import { canonicalUnit, foodAsLoggable, mergeIngredients, recipeTotals, roundTo } from '@cycling-coach/core';
import type { Food, FoodLibrary, Recipe, RecipeDraft, RecipeIngredient, RecipeInput } from '@cycling-coach/shared';
import { useId, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { TrashIcon, XIcon } from '../../components/icons';
import { Button, ErrorNote, Field, Stepper, inputCls } from '../../components/ui';
import { fmtG, fmtKcal } from '../../lib/food';
import { useFoodMutations, useRecipeDraftMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { ItemSearch } from './ItemSearch';
import { PortionRow } from './PortionRow';
import { RecipeTextAdd, type Pending } from './RecipeTextAdd';

/**
 * Recipe builder: ingredients from the user's foods at any amount and unit, makes
 * N servings, optional finished weight so a batch can be logged by the gram. Totals are computed
 * from the foods as they are now, so editing an ingredient food updates the recipe. Ingredients can
 * also be typed or pasted and matched with AI (`RecipeTextAdd`, DECISIONS #107).
 *
 * It also finishes a coach recipe from chat (`draft`, DECISIONS #108): the lines matched to the user's
 * foods come in as ingredients, and staples and unmatched lines wait as cards to confirm, search or skip.
 * Saving makes it a Library recipe and marks the draft saved.
 */

/** A coach draft as the editor starts it. A staple they've already saved as a food goes straight in. */
function seedFromDraft(draft: RecipeDraft, foods: readonly Food[]): { ingredients: RecipeIngredient[]; pending: Pending[]; toTaste: string[] } {
  const ingredients: RecipeIngredient[] = [];
  const pending: Pending[] = [];
  const toTaste: string[] = [];
  draft.ingredients.forEach((l, i) => {
    if (l.toTaste) return void toTaste.push(l.name);
    const m = l.match;
    const saved = m?.kind === 'staple' ? foods.find((f) => !f.archived && f.source === m.source && f.sourceRef === m.ref) : undefined;
    const foodId = m?.kind === 'food' ? m.foodId : saved?.id;
    if (foodId) ingredients.push({ foodId, quantity: l.quantity, unit: canonicalUnit(l.unit), label: l.name });
    else pending.push({ name: l.name, quantity: l.quantity, unit: l.unit, toTaste: false, key: i, staple: m?.kind === 'staple' ? m : null, others: [] });
  });
  return { ingredients, pending, toTaste };
}

export function RecipeEditor({
  lib,
  today,
  recipe,
  draft,
  onClose,
  onSaved,
  onDraftSaved,
}: {
  lib: FoodLibrary;
  today: string;
  recipe?: Recipe | undefined;
  /** A coach recipe from chat, not yet saved. */
  draft?: RecipeDraft | undefined;
  onClose: () => void;
  onSaved?: ((r: Recipe, log: boolean) => void) | undefined;
  onDraftSaved?: ((d: RecipeDraft, log: boolean) => void) | undefined;
}) {
  const id = useId();
  const m = useFoodMutations();
  const dm = useRecipeDraftMutations(draft?.id ?? '');
  const [seed0] = useState(() => (draft ? seedFromDraft(draft, lib.foods) : null));
  const [name, setName] = useState(recipe?.name ?? draft?.name ?? '');
  const [servings, setServings] = useState(recipe?.servings ?? draft?.servings ?? 2);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>(recipe?.ingredients ?? seed0?.ingredients ?? []);
  /** Lines still waiting in the cards above the list: Save leaves them out. */
  const [notAdded, setNotAdded] = useState<string[]>([]);
  const [finished, setFinished] = useState(recipe?.finishedGrams ? String(recipe.finishedGrams) : '');
  const [notes, setNotes] = useState(recipe?.notes ?? '');
  /** One step per line (coach recipes come with them). */
  const [steps, setSteps] = useState((recipe?.steps ?? draft?.steps ?? []).join('\n'));
  const stepList = steps.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30);
  const [aliases, setAliases] = useState(recipe?.aliases.join(', ') ?? '');
  /** Uncounted seasonings: from a coach recipe, or typed ("pinch of salt"). */
  const [toTaste, setToTaste] = useState<string[]>(recipe?.toTaste ?? seed0?.toTaste ?? []);
  /** A "Search" from a typed line that isn't in their foods. */
  const [seed, setSeed] = useState<{ q: string; at: number }>();
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
      ...(toTaste.length ? { toTaste } : {}),
    };
  };

  const save = (log: boolean) => {
    const body = input();
    if (!body) return;
    setError(null);
    const fail = (e: unknown) => setError(errorMessage(e));
    if (draft) dm.saveEdited.mutate(body, { onSuccess: (d) => onDraftSaved?.(d, log), onError: fail });
    else if (recipe) {
      const unset = [...(!finishedG && recipe.finishedGrams ? (['finishedGrams'] as const) : []), ...(!body.notes && recipe.notes ? (['notes'] as const) : []), ...(!body.steps && recipe.steps?.length ? (['steps'] as const) : []), ...(!body.toTaste && recipe.toTaste?.length ? (['toTaste'] as const) : [])];
      m.updateRecipe.mutate({ id: recipe.id, patch: { ...body, ...(unset.length ? { unset } : {}) } }, { onSuccess: (r) => onSaved?.(r, log), onError: fail });
    } else m.createRecipe.mutate(body, { onSuccess: (r) => onSaved?.(r, log), onError: fail });
  };

  const busy = m.createRecipe.isPending || m.updateRecipe.isPending || dm.saveEdited.isPending;
  const per = totals.perServing;
  return (
    <Dialog
      title={recipe ? 'Edit recipe' : draft ? 'Finish recipe' : 'New recipe'}
      width={980}
      tall
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error && <ErrorNote>{error}</ErrorNote>}
          {notAdded.length > 0 && <div className="text-[13px] text-[#9A5B13]">Not added yet, so Save leaves out: {notAdded.join(', ')}.</div>}
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
            <div className="pt-1.5 pb-2">
              <RecipeTextAdd
                onFoods={(ings) => setIngredients((xs) => mergeIngredients(xs, ings))}
                onServings={setServings}
                onToTaste={(names) => setToTaste((xs) => [...xs, ...names.filter((n) => !xs.some((x) => x.toLowerCase() === n.toLowerCase()))].slice(0, 20))}
                onFoodSaved={(food) => setExtraFoods((xs) => [...xs, food])}
                onSearch={(q) => setSeed({ q, at: Date.now() })}
                initialPending={seed0?.pending}
                onPendingChange={setNotAdded}
              />
            </div>
            {ingredients.map((ing, i) => {
              const food = foodsById.get(ing.foodId);
              return (
                <PortionRow
                  key={`${ing.foodId}:${i}`}
                  item={food ? foodAsLoggable(food) : undefined}
                  name="Missing food"
                  label={ing.label}
                  portion={{ quantity: ing.quantity, unit: ing.unit }}
                  onChange={(p) => setIngredients(ingredients.map((x, j) => (j === i ? { ...x, ...p } : x)))}
                  onRemove={() => setIngredients(ingredients.filter((_, j) => j !== i))}
                />
              );
            })}
            {!ingredients.length && <div className="py-2 text-[13px] text-muted">No ingredients yet.</div>}
            {toTaste.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2 text-[13px]">
                <span className="text-muted">To taste, not counted:</span>
                {toTaste.map((t) => (
                  <span key={t} className="flex items-center gap-0.5 rounded-full border border-line bg-surface pl-2.5 text-ink">
                    {t}
                    <button type="button" aria-label={`Remove ${t}`} onClick={() => setToTaste(toTaste.filter((x) => x !== t))} className="flex h-7 w-7 items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-surface-2">
                      <XIcon size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
          <ItemSearch
            lib={lib}
            today={today}
            kinds={['food']}
            placeholder="Add ingredient from your foods…"
            seed={seed}
            onPick={(item, p) => setIngredients([...ingredients, { foodId: item.id, quantity: p.quantity, unit: p.unit }])}
            addNew={{
              target: 'recipe',
              onSaved: (food, p, add) => {
                setExtraFoods((xs) => [...xs, food]);
                if (add) setIngredients((xs) => [...xs, { foodId: food.id, quantity: p.quantity, unit: p.unit }]);
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
