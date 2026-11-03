import { formatPortion, scaleLines } from '@cycling-coach/core';
import type { RecipeView } from '@cycling-coach/shared';
import { fmtG, fmtKcal } from '../../lib/food';
import { ClockIcon } from '../icons';
import { ServingsPicker } from '../ServingsPicker';
import { StepText } from './StepText';

/**
 * A recipe to read (DECISIONS #47): the Library recipe page and a share link. Amounts follow
 * "Cooking for N" (scaled for display only — the saved recipe is untouched); per-serving
 * nutrition doesn't change with it.
 */

/** The amounts for `servings` instead of the recipe's own count. */
export const linesFor = (view: RecipeView, servings: number) => scaleLines(view.ingredients, view.servings, servings);

export function RecipeMeta({ view }: { view: RecipeView }) {
  const per = view.perServing;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      {view.minutes && (
        <span className="inline-flex items-center gap-1">
          <ClockIcon /> {view.minutes} min
        </span>
      )}
      <span>
        <span className="font-mono font-semibold text-ink">
          {view.uncounted ? '≈ ' : ''}
          {fmtKcal(per.kcal)}
        </span>{' '}
        kcal / serving
      </span>
      <span className="font-mono text-xs">
        P {fmtG(per.protein)} · C {fmtG(per.carbs)} · F {fmtG(per.fat)} g
      </span>
    </div>
  );
}

export function RecipeBody({ view, servings, onServings }: { view: RecipeView; servings: number; onServings: (n: number) => void }) {
  const lines = linesFor(view, servings);
  const scaled = Math.abs(servings - view.servings) > 1e-9;
  return (
    <div className="flex flex-col gap-5">
      {view.description && <p className="m-0 text-[15px] text-muted">{view.description}</p>}
      <RecipeMeta view={view} />
      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-base font-semibold">Ingredients</h2>
          <ServingsPicker value={servings} onChange={onServings} />
        </div>
        {scaled && <div className="text-xs text-muted">Amounts for {servings} — the recipe makes {view.servings}.</div>}
        <ul className="m-0 flex list-none flex-col divide-y divide-divider rounded-[12px] border border-line bg-surface p-0">
          {lines.map((l, i) => (
            <li key={i} className="flex items-baseline gap-3 px-3.5 py-2.5">
              <span className="w-[84px] flex-none font-mono text-[14px] font-semibold">{formatPortion(l.quantity, l.unit)}</span>
              <span className="min-w-0 text-[15px]">{l.label}</span>
            </li>
          ))}
        </ul>
        {view.toTaste.length > 0 && (
          <div className="text-[13px] text-muted">
            <span className="font-semibold text-ink">To taste:</span> {view.toTaste.join(', ')}
          </div>
        )}
      </section>
      {view.steps.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="m-0 text-base font-semibold">Method</h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {view.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-tint-2 font-mono text-[13px] font-semibold text-accent-ink">{i + 1}</span>
                <span className="min-w-0 pt-0.5 [&_strong]:font-semibold [&_strong]:text-ink">
                  <StepText text={s} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {view.notes && (
        <section className="flex flex-col gap-1.5">
          <h2 className="m-0 text-base font-semibold">Notes</h2>
          <p className="m-0 text-[14px] whitespace-pre-wrap text-muted">{view.notes}</p>
        </section>
      )}
    </div>
  );
}
