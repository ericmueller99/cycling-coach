import { formatLongDay, formatPortion } from '@cycling-coach/core';
import type { DraftIngredient, FoodLibrary, IngredientSuggestion, IsoDate, MealIdea, MealIdeas } from '@cycling-coach/shared';
import { useState, type ReactNode } from 'react';
import { CheckIcon, XIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { Button, ErrorNote, SectionLabel, Spinner } from '../../components/ui';
import { fmtG, fmtKcal } from '../../lib/food';
import { useFoodLibrary, useMealIdeaFix, useMealIdeas } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { ItemSearch } from '../food/ItemSearch';
import { SourceTag } from '../food/SourceTag';
import { MakeServings, MakeThisButton, servingsText } from './foodBlocks';
import { useFoodLeft } from './FoodStrip';
import { StapleTag } from './RecipePane';
import { RIGHT_COL } from './rightColumn';

/**
 * A meal idea's Details pane: what's in it, how it's
 * made and how it fits the day — before the user picks it. Opening it generates and logs nothing. The
 * one action is Make this; an unmatched ingredient can be matched inline (no AI call), which
 * re-prices the pane and the card.
 */

const AMBER_TAG = 'flex-none rounded-[5px] bg-[#FEF3E7] px-1.5 text-[10px] leading-[17px] font-bold text-[#B54708]';

function SourceBadge({ line }: { line: DraftIngredient }) {
  if (line.toTaste) return null;
  if (line.problem === 'unmatched') return <span className={AMBER_TAG}>Not matched</span>;
  if (line.problem === 'unit') return <span className={AMBER_TAG}>Check amount</span>;
  if (line.match?.kind === 'food') return <SourceTag source={line.match.source} />;
  if (line.match?.kind === 'staple') return <StapleTag />;
  return null;
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[9px] bg-surface-2 p-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-mono text-[17px] font-semibold">{value}</div>
    </div>
  );
}

function FitBar({ label, note, noteClass, pct, color }: { label: string; note: string; noteClass: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2 text-[13px]">
        <span className="flex-auto">{label}</span>
        <span className={`font-mono text-xs ${noteClass}`}>{note}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded bg-track">
        <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
    </div>
  );
}

/** "Numbers incomplete" — one row per unmatched ingredient with its offered matches. */
function Misses({ ideas, index, idea, lib, today }: { ideas: MealIdeas; index: number; idea: MealIdea; lib: FoodLibrary; today: IsoDate }) {
  const fix = useMealIdeaFix(ideas.id);
  const [searching, setSearching] = useState<number | null>(null);
  const misses = idea.ingredients.map((line, i) => ({ line, i })).filter(({ line }) => !line.toTaste && line.problem === 'unmatched');
  if (!misses.length) return null;
  const pick = (ingredient: number, s: IngredientSuggestion | { kind: 'food'; foodId: string }) =>
    fix.mutate(
      { idea: index, ingredient, ...(s.kind === 'food' ? { foodId: s.foodId } : { staple: { source: s.source, ref: s.ref } }) },
      { onSuccess: () => setSearching(null) },
    );
  const chip = 'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs mobile:min-h-[40px]';
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-dashed border-[#E9B98A] bg-[#FFFBF5] px-3 py-2.5">
      <div className="font-semibold text-[#B54708]">
        Numbers incomplete — {misses.length} not matched
      </div>
      <div className="text-xs text-muted">Totals leave {misses.length === 1 ? 'it' : 'these'} out. Pick a match and the card updates.</div>
      {misses.map(({ line, i }) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="min-w-[120px] font-semibold">{line.name}</span>
            {(line.suggestions ?? []).map((s) => (
              <button
                key={s.kind === 'food' ? s.foodId : `${s.source}:${s.ref}`}
                type="button"
                disabled={fix.isPending}
                onClick={() => pick(i, s)}
                className={`${chip} border-[#ABEFC6] bg-[#F3FAF5] text-[#085D3A]`}
              >
                {s.name}
                {s.kind === 'food' ? <SourceTag source={s.source} /> : <span className="text-[10px] font-bold">CNF</span>}
              </button>
            ))}
            <button
              type="button"
              aria-expanded={searching === i}
              onClick={() => setSearching(searching === i ? null : i)}
              className={`${chip} border-line-strong bg-surface text-ink`}
            >
              Search my foods…
            </button>
          </div>
          {searching === i && (
            <ItemSearch
              lib={lib}
              today={today}
              kinds={['food']}
              placeholder={`Search your foods for “${line.name}”`}
              onPick={(item) => pick(i, { kind: 'food', foodId: item.id })}
              addNew={{ target: 'recipe', onSaved: (food, _portion, add) => add && pick(i, { kind: 'food', foodId: food.id }) }}
            />
          )}
        </div>
      ))}
      {fix.error && <ErrorNote>{errorMessage(fix.error)}</ErrorNote>}
    </div>
  );
}

function Body({ ideas, index, idea, lib, today }: { ideas: MealIdeas; index: number; idea: MealIdea; lib: FoodLibrary; today: IsoDate }) {
  const { kcalLeft, proteinLeft } = useFoodLeft(ideas.date);
  const per = idea.perServing;
  const approx = idea.unpriced.length > 0;
  const kcal = per ? Math.round(per.kcal) : null;
  const protein = per ? Math.round(per.protein) : null;
  const when = ideas.date === today ? (ideas.slot === 'Dinner' ? 'tonight' : ideas.slot.toLowerCase()) : `${ideas.slot} · ${formatLongDay(ideas.date)}`;
  const range = ideas.kcalRange;
  const inRange = range && kcal != null && kcal >= range.min && kcal <= range.max;

  return (
    <>
      <Misses ideas={ideas} index={index} idea={idea} lib={lib} today={today} />

      <div className="flex flex-col gap-2">
        <SectionLabel>Nutrition · 1 serving</SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          <Tile label="Calories" value={kcal == null ? '—' : `${approx ? '≈' : ''}${fmtKcal(kcal)}`} />
          <Tile label="Protein" value={per ? `${fmtG(per.protein)} g` : '—'} />
          <Tile label="Carbs" value={per ? `${fmtG(per.carbs)} g` : '—'} />
          <Tile label="Fat" value={per ? `${fmtG(per.fat)} g` : '—'} />
        </div>
      </div>

      {(kcal != null || idea.why) && (
        <div className="flex flex-col gap-2">
          <SectionLabel>How it fits {when}</SectionLabel>
          {kcal != null && kcalLeft != null && kcalLeft > 0 && (
            <FitBar
              label={`Calories · ${fmtKcal(kcal)} of ${fmtKcal(kcalLeft)} left`}
              note={kcalLeft - kcal >= 0 ? `${fmtKcal(kcalLeft - kcal)} left after` : `${fmtKcal(kcal - kcalLeft)} over`}
              noteClass={kcalLeft - kcal >= 0 ? 'text-accent-ink' : 'text-danger'}
              pct={(kcal / kcalLeft) * 100}
              color="#7DA30A"
            />
          )}
          {protein != null && proteinLeft != null && proteinLeft > 0 && (
            <FitBar
              label={`Protein · ${protein} of ${Math.round(proteinLeft)} g left`}
              note={proteinLeft - protein > 0 ? `${Math.round(proteinLeft - protein)} g still to go` : 'target hit'}
              noteClass="text-muted"
              pct={(protein / proteinLeft) * 100}
              color="#3B8BF6"
            />
          )}
          {range && kcal != null && (
            <FitBar
              label={`Your range · ${fmtKcal(range.min)}–${fmtKcal(range.max)} kcal`}
              note={inRange ? 'in range' : 'outside range'}
              noteClass={inRange ? 'text-success' : 'text-[#B54708]'}
              pct={(kcal / range.max) * 100}
              color="#E9B80F"
            />
          )}
          {idea.why && (
            <div className="flex gap-2 rounded-[10px] border border-accent-line bg-accent-tint px-3 py-2.5 text-[13px]">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-none text-accent-ink">
                <path d="M3 17l5-6 4 3 4-7 5 10" />
              </svg>
              <span>{idea.why}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col">
        <SectionLabel>{idea.servings === 1 ? 'Ingredients' : `Ingredients · makes ${servingsText(idea.servings)}`}</SectionLabel>
        <ul className="m-0 mt-1.5 flex list-none flex-col divide-y divide-divider p-0">
          {idea.ingredients.map((line, i) => {
            const miss = !line.toTaste && !!line.problem;
            return (
              <li key={i} className="flex items-center gap-2 py-[7px] text-[13px]">
                <span className={`flex min-w-0 flex-auto items-center gap-1.5 ${line.toTaste ? 'text-muted' : miss ? 'text-[#B54708]' : ''}`}>
                  <span className="truncate">{line.name}</span>
                  <SourceBadge line={line} />
                </span>
                <span className="min-w-16 text-right font-mono text-xs text-muted">{line.toTaste ? 'to taste' : formatPortion(line.quantity, line.unit)}</span>
                <span className={`min-w-11 text-right font-mono text-xs ${miss ? 'text-[#B54708]' : ''}`}>{line.toTaste ? '' : line.kcal != null ? fmtKcal(line.kcal) : '—'}</span>
                <span className="min-w-10 text-right font-mono text-xs text-muted">{line.toTaste ? '' : line.protein != null ? `${fmtG(line.protein)} g` : '—'}</span>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2 text-[11px] text-muted">
          <span>kcal</span>
          <span className="min-w-10 text-right">protein</span>
        </div>
      </div>

      {idea.steps?.length ? (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>How it's made</SectionLabel>
          <ol className="m-0 flex flex-col gap-1 pl-5 text-[13px]">
            {idea.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="text-xs text-muted">Full recipe with amounts and timings when you pick it.</div>
        </div>
      ) : null}

      {(idea.equipment?.length || idea.leftovers) && (
        <div className="flex flex-wrap gap-1.5">
          {idea.equipment?.length ? <span className="inline-flex min-h-[26px] items-center rounded-full border border-line px-3 text-xs text-muted">Equipment: {idea.equipment.join(', ')}</span> : null}
          {idea.leftovers && <span className="inline-flex min-h-[26px] items-center rounded-full border border-line px-3 text-xs text-muted">Leftovers: {idea.leftovers}</span>}
        </div>
      )}
    </>
  );
}

export function IdeaDetailsPane({
  ideasId,
  index,
  initial,
  today,
  mobile,
  onIndex,
  onMake,
  onClose,
}: {
  ideasId: string;
  index: number;
  initial?: MealIdeas | undefined;
  today: IsoDate;
  mobile: boolean;
  onIndex: (index: number) => void;
  /** Make this was pressed — the message is already sent; the pane closes (the recipe pane opens when it's built). */
  onMake: () => void;
  onClose: () => void;
}) {
  const { data: ideas, error } = useMealIdeas(ideasId, initial);
  const { data: lib } = useFoodLibrary();
  const idea = ideas?.ideas[index];
  const count = ideas?.ideas.length ?? 0;
  const picked = !!ideas?.picked.includes(index);

  const body = error ? (
    <ErrorNote>{errorMessage(error)}</ErrorNote>
  ) : !ideas || !lib ? (
    <Spinner />
  ) : !idea ? (
    <ErrorNote>That idea isn't there any more.</ErrorNote>
  ) : (
    <Body ideas={ideas} index={index} idea={idea} lib={lib} today={today} />
  );

  const footer = idea ? (
    picked ? (
      <Button size="lg" variant="neutral" className="w-full" disabled>
        <CheckIcon /> Picked — recipe in the chat
      </Button>
    ) : (
      <div className="flex flex-col gap-2.5">
        <MakeServings idea={idea} ideaKey={`${ideas!.id}.${index}`} />
        <MakeThisButton idea={idea} ideaKey={`${ideas!.id}.${index}`} size="lg" className="w-full" label="Make this — full recipe & log" onSent={onMake} />
      </div>
    )
  ) : null;

  const pager = count > 1 && (
    <div className="flex items-center gap-2">
      <Button size="sm" className="w-8 px-0!" aria-label="Previous idea" onClick={() => onIndex((index + count - 1) % count)}>
        ‹
      </Button>
      <span className="font-mono text-xs text-muted">
        Idea {index + 1} of {count}
      </span>
      <Button size="sm" className="w-8 px-0!" aria-label="Next idea" onClick={() => onIndex((index + 1) % count)}>
        ›
      </Button>
    </div>
  );

  const head = idea && (
    <div className="flex flex-col gap-1.5">
      <span className={`self-start rounded-md px-2 py-0.5 text-[11px] font-semibold ${index === 0 ? 'bg-accent-tint-2 text-accent-ink' : 'bg-hover text-muted'}`}>{idea.tag}</span>
      {!mobile && <h2 className="m-0 text-lg leading-snug font-bold">{idea.name}</h2>}
      <div className="text-[13px] text-muted">{idea.description}</div>
      <div className="font-mono text-xs text-muted">
        {servingsText(idea.servings)} · {idea.minutes} min{idea.difficulty ? ` · ${idea.difficulty}` : ''}
      </div>
    </div>
  );

  if (mobile) {
    return (
      <Sheet
        title={idea?.name ?? 'Meal idea'}
        header={head}
        tall
        onClose={onClose}
        footer={footer}
      >
        <div className="flex flex-col gap-4">
          {pager}
          {body}
        </div>
      </Sheet>
    );
  }
  return (
    <aside aria-label="Meal details" className={`flex flex-col border-l border-line bg-surface ${RIGHT_COL}`}>
      <div className="flex flex-col gap-1.5 border-b border-line px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          {pager}
          <span className="flex-auto" />
          <button type="button" aria-label="Close details" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-hover">
            <XIcon size={16} />
          </button>
        </div>
        {head}
      </div>
      <div className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto px-4 py-3.5">{body}</div>
      {footer && <div className="border-t border-line px-4 pt-3 pb-4">{footer}</div>}
    </aside>
  );
}
