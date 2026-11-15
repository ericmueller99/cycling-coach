import { computePortion, defaultPortionIndex, fitPortion, foodFromStaple, formatPortion, isStandardUnit, unitKey } from '@cycling-coach/core';
import type { FinishedVolume, Food, FoodInput, IngredientLine, RecipeIngredient, RecipeTextResult, StapleMatch } from '@cycling-coach/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { SparkleIcon } from '../../components/icons';
import { Button, ErrorNote, errorContent } from '../../components/ui';
import { api, unwrap } from '../../lib/api';
import { fmtKcal } from '../../lib/food';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';

/** A typed line that didn't match one of the user's foods: staples to choose from (best first), or none. */
export type Pending = IngredientLine & { key: number; staple: StapleMatch | null; others: StapleMatch[] };

async function readText(text: string): Promise<RecipeTextResult> {
  return unwrap(await api.api.food['recipe-text'].$post({ json: { text } }));
}

const amount = (l: { quantity: number; unit: string }) => `${l.quantity} ${l.unit === 'fl_oz' ? 'fl oz' : l.unit}`;
/** "1 cup flour", but "2 eggs" rather than "2 egg eggs" when the unit is the food itself. */
const typed = (l: IngredientLine) => {
  const u = unitKey(l.unit);
  return !isStandardUnit(u) && unitKey(l.name.toLowerCase()).includes(u) ? `${l.quantity} ${l.name}` : `${amount(l)} ${l.name}`;
};

/**
 * The staple as the food it would become, and the amount to add: as typed when the food can measure it;
 * a count ("2 carrots") as that many of its usual piece ("2 medium"); otherwise its usual portion.
 */
function stapleFood(p: Pending): { input: FoodInput; quantity: number; unit: string; kcal: number | null } {
  const input = foodFromStaple(p.staple!.detail, { name: p.staple!.name, defaultIndex: defaultPortionIndex(p.staple!.detail.portions) });
  const { quantity, unit } = fitPortion(input, p.quantity, p.unit) ?? input.defaultPortion;
  return { input, quantity, unit, kcal: computePortion(input, quantity, unit)?.nutrients.kcal ?? null };
}

/**
 * "Add with AI" in the recipe editor (DECISIONS #107). Typed or pasted ingredients go to the small
 * model, which matches them to the user's foods. Those go straight into the unsaved recipe (a food
 * already in it takes the new amount), "makes 6" sets the servings and "makes 4 cups" the total volume. A staple is saved to their foods
 * only when they click it; anything else waits here to be searched for or skipped. A coach recipe opened
 * in the editor starts with its staple and unmatched lines here (`initialPending`, DECISIONS #108).
 */
export function RecipeTextAdd({
  onFoods,
  onServings,
  onVolume,
  onToTaste,
  onFoodSaved,
  onSearch,
  initialPending,
  onPendingChange,
}: {
  onFoods: (ings: RecipeIngredient[]) => void;
  onServings: (n: number) => void;
  /** "Makes 4 cups" (DECISIONS #111). */
  onVolume: (v: FinishedVolume) => void;
  onToTaste: (names: string[]) => void;
  /** A staple was saved as one of their foods (the library hasn't refetched yet). */
  onFoodSaved: (food: Food) => void;
  onSearch: (name: string) => void;
  /** Cards to start with: a coach recipe's lines that aren't the user's foods yet. Read once. */
  initialPending?: Pending[] | undefined;
  /** The names still waiting here, so the editor can say what Save leaves out. */
  onPendingChange?: ((names: string[]) => void) | undefined;
}) {
  const m = useFoodMutations();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>(initialPending ?? []);
  const pendingNames = pending.map((p) => p.name).join('\n');
  useEffect(() => onPendingChange?.(pendingNames ? pendingNames.split('\n') : []), [pendingNames]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const read = useMutation({ mutationFn: readText });

  const run = () => {
    const t = text.trim();
    if (t.length < 2 || read.isPending) return;
    setError(null);
    setNote(null);
    read.mutate(t, {
      onSuccess: (r) => {
        const foods = r.lines.flatMap((l) => (!l.toTaste && l.match?.kind === 'food' ? [{ foodId: l.match.foodId, quantity: l.quantity, unit: l.unit }] : []));
        const toTaste = r.lines.filter((l) => l.toTaste).map((l) => l.name);
        const rest = r.lines
          .filter((l) => !l.toTaste && l.match?.kind !== 'food')
          .map(({ match, alternatives, ...l }, i): Pending => ({ ...l, key: Date.now() + i, staple: match?.kind === 'staple' ? match : null, others: alternatives ?? [] }));
        if (foods.length) onFoods(foods);
        if (toTaste.length) onToTaste(toTaste);
        if (r.servings) onServings(r.servings);
        if (r.volume) onVolume(r.volume);
        // Typing a line again replaces its card.
        setPending((ps) => [...ps.filter((p) => !rest.some((x) => x.name.toLowerCase() === p.name.toLowerCase())), ...rest]);
        const parts = [
          foods.length ? `Added ${foods.length} from your foods` : null,
          r.servings ? `Makes ${r.servings}` : null,
          r.volume ? `${r.servings ? '' : 'Makes '}${formatPortion(r.volume.quantity, r.volume.unit)}` : null,
          toTaste.length ? `${toTaste.length} to taste` : null,
          rest.length ? `${rest.length} to check below` : null,
        ].filter(Boolean);
        setNote(parts.length ? `${parts.join(' · ')}.` : 'No ingredients found in that — try “1 cup flour, 2 eggs”.');
        if (foods.length || toTaste.length || r.servings || r.volume) setText('');
      },
      onError: (e) => setError(errorContent(e)),
    });
  };

  const drop = (key: number) => setPending((ps) => ps.filter((p) => p.key !== key));
  /** "Or: …" makes another staple the one offered. */
  const choose = (key: number, pick: StapleMatch) =>
    setPending((ps) => ps.map((p) => (p.key === key && p.staple ? { ...p, staple: pick, others: [p.staple, ...p.others.filter((o) => o.ref !== pick.ref)] } : p)));

  const saveStaples = async (ps: Pending[]) => {
    setError(null);
    setNote(null);
    for (const p of ps) {
      const { input, quantity, unit } = stapleFood(p);
      try {
        const food = await m.createFood.mutateAsync(input);
        onFoodSaved(food);
        // The name as typed ("green beans") reads better in the recipe than the staple's.
        onFoods([{ foodId: food.id, quantity, unit, label: p.name }]);
        drop(p.key);
      } catch (e) {
        setError(errorMessage(e));
        return;
      }
    }
  };

  const staples = pending.filter((p) => p.staple);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col rounded-[12px] border border-line-strong bg-surface focus-within:border-accent-ring focus-within:shadow-[0_0_0_3px_rgba(125,163,10,.18)]">
        <textarea
          aria-label="Type or paste ingredients"
          rows={2}
          value={text}
          placeholder="e.g. “1 cup flour, 1 cup milk, 1 egg, 1 tsp baking powder, makes 6 pancakes”"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run();
            }
          }}
          className="min-h-16 resize-y rounded-t-[12px] border-0 bg-transparent px-3 py-2.5 text-[15px] text-ink outline-none"
        />
        <div className="flex items-center gap-2 border-t border-divider px-2 py-1.5">
          <span className="min-w-0 flex-auto px-1 text-xs text-muted">Matches your foods; anything else you confirm below.</span>
          <kbd className="rounded border border-line px-1 font-mono text-[11px] text-muted mobile:hidden">⌘↵</kbd>
          <Button size="sm" variant="primary" className="flex-none whitespace-nowrap" disabled={text.trim().length < 2 || read.isPending} onClick={run}>
            <SparkleIcon size={14} /> {read.isPending ? 'Reading…' : 'Add with AI'}
          </Button>
        </div>
      </div>
      {note && (
        <div role="status" className="px-1 text-[13px] text-muted">
          {note}
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {pending.length > 0 && (
        <section aria-label="Ingredients to check" className="flex flex-col gap-2">
          {staples.length > 1 && (
            <Button size="sm" className="self-start" disabled={m.createFood.isPending} onClick={() => void saveStaples(staples)}>
              Use all {staples.length} staples
            </Button>
          )}
          {pending.map((p) => {
            const s = p.staple ? stapleFood(p) : null;
            return (
              <div key={p.key} className="flex flex-col gap-2 rounded-[12px] border border-dashed border-[#E9B98A] bg-[#FFFBF5] p-3">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-auto">
                    <strong>{typed(p)}</strong>{' '}
                    isn't in your foods
                  </span>
                  <span className="rounded bg-[#FFF4E5] px-1.5 text-[11px] font-bold text-[#9A5B13]">Not added</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s && (
                    <Button size="sm" className="h-auto max-w-full py-1.5 text-left" disabled={m.createFood.isPending} onClick={() => void saveStaples([p])}>
                      Use staple: {p.staple!.name} · {amount(s)}
                      {s.kcal != null ? ` · ${fmtKcal(s.kcal)} kcal` : ''}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      onSearch(p.name);
                      drop(p.key);
                    }}
                  >
                    Search
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => drop(p.key)}>
                    Skip
                  </Button>
                </div>
                {p.others.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted">Or:</span>
                    {p.others.map((o) => (
                      <button key={`${o.source}:${o.ref}`} type="button" onClick={() => choose(p.key, o)} className="min-h-8 rounded-full border border-line-strong bg-surface px-2.5 text-left text-[13px] text-ink hover:bg-surface-2">
                        {o.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
