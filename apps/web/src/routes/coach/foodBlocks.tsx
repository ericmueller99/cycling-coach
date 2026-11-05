import { formatLongDay, formatQuantity, macroSplit } from '@cycling-coach/core';
import type { MealIdea, MealIdeas, RecipeDraft } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { createContext, useContext } from 'react';
import { CheckIcon, ChevronRight, ForkKnifeIcon } from '../../components/icons';
import { MacroBar } from '../../components/MacroBar';
import { ServingsPicker } from '../../components/ServingsPicker';
import { Button, Card } from '../../components/ui';
import { fmtG, fmtKcal } from '../../lib/food';
import type { TurnOrigin } from '../../lib/coachTurn';
import { useMealIdeas, useRecipeDraft } from '../../lib/foodQueries';

/**
 * Meal ideas and recipe cards in Coach chat. The cards read
 * their own documents (`meal_ideas`, `recipe_drafts`) — the transcript only holds their ids.
 */

export interface CoachFoodActions {
  /** Send a message as the user ("Make the Greek bowl, 2 servings"). */
  send: (text: string, origin?: TurnOrigin) => void;
  openRecipe: (draftId: string) => void;
  /** The recipe open in the pane. */
  openId?: string | undefined;
  /** Open a meal idea's Details pane, key "{ideasId}.{index}". */
  openIdea: (key: string) => void;
  /** The idea open in the Details pane. */
  openIdeaKey?: string | undefined;
  busy: boolean;
  /** The idea whose Make this is being written now ("{ideasId}.{index}"). */
  makingKey?: string | undefined;
  /** Servings picked for an idea before Make this, by key (card and Details pane share it). */
  servingsFor: (key: string, idea: MealIdea) => number;
  setServings: (key: string, n: number) => void;
  /** Open the food logger on these words: it matches them and they confirm there. */
  logWords: (phrase: string) => void;
}

export const CoachFoodContext = createContext<CoachFoodActions>({
  send: () => {},
  openRecipe: () => {},
  openIdea: () => {},
  busy: false,
  servingsFor: (_k, idea) => idea.servings,
  setServings: () => {},
  logWords: () => {},
});

export const servingsText = (n: number) => `${formatQuantity(n)} serving${n === 1 ? '' : 's'}`;

/** What Make this sends — the card and the Details pane say the same thing. */
export const makeThisText = (idea: MealIdea, servings = idea.servings) => `Make the ${idea.name}, ${servingsText(servings)}.`;

/** Make this, or "Writing recipe…" while the coach writes this one. */
export function MakeThisButton({
  idea,
  ideaKey,
  size = 'sm',
  className = '',
  label = 'Make this',
  onSent,
}: {
  idea: MealIdea;
  ideaKey: string;
  size?: 'sm' | 'lg';
  className?: string;
  label?: string;
  onSent?: (() => void) | undefined;
}) {
  const { send, busy, makingKey, servingsFor } = useContext(CoachFoodContext);
  const making = makingKey === ideaKey;
  return (
    <Button
      size={size}
      variant={size === 'lg' ? 'primary' : 'secondary'}
      className={className}
      disabled={busy}
      aria-busy={making}
      onClick={() => {
        send(makeThisText(idea, servingsFor(ideaKey, idea)), { kind: 'make', ideaKey });
        onSent?.();
      }}
    >
      {making ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {size === 'lg' ? 'Writing recipe…' : 'Writing…'}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/** The servings stepper next to Make this. */
export function MakeServings({ idea, ideaKey }: { idea: MealIdea; ideaKey: string }) {
  const { busy, servingsFor, setServings } = useContext(CoachFoodContext);
  return <ServingsPicker value={servingsFor(ideaKey, idea)} onChange={(n) => setServings(ideaKey, n)} disabled={busy} />;
}

function IdeaCard({ idea, ideasId, index, picked }: { idea: MealIdea; ideasId: string; index: number; picked: boolean }) {
  const { openIdea, openIdeaKey } = useContext(CoachFoodContext);
  const per = idea.perServing;
  const approx = idea.unpriced.length > 0;
  const key = `${ideasId}.${index}`;
  const viewing = openIdeaKey === key;
  return (
    <Card className={`flex min-w-0 flex-col gap-2 p-3.5 ${viewing ? 'border-2! border-[#7DA30A]! bg-[#F9FCEF]!' : picked ? 'border-accent-ring' : ''}`}>
      <span className={`self-start rounded-md px-2 py-0.5 text-[11px] font-semibold ${index === 0 ? 'bg-accent-tint-2 text-accent-ink' : 'bg-hover text-muted'}`}>{idea.tag}</span>
      <div className="font-semibold leading-snug">{idea.name}</div>
      <div className="text-[13px] text-muted">{idea.description}</div>
      <div className="mt-auto font-mono text-xs text-muted">
        {idea.minutes} min · {per ? `${approx ? '≈ ' : ''}${fmtKcal(per.kcal)} kcal · P ${fmtG(per.protein)}` : 'not priced'}
      </div>
      {per && per.kcal > 0 && <MacroBar {...macroSplit(per)} />}
      {approx && <div className="text-[11px] text-[#9A5B13]">Not counted: {idea.unpriced.join(', ')}</div>}
      {!picked && <MakeServings idea={idea} ideaKey={key} />}
      <div className="mt-0.5 flex gap-1.5">
        <Button
          size="sm"
          className={`flex-1 ${viewing ? 'border-[#7DA30A]! bg-accent-tint! font-semibold' : ''}`}
          aria-pressed={viewing}
          onClick={() => openIdea(key)}
        >
          {viewing ? 'Viewing' : 'Details'}
        </Button>
        {picked ? (
          <Button size="sm" variant="neutral" className="flex-1" disabled>
            <CheckIcon /> Picked
          </Button>
        ) : (
          <MakeThisButton idea={idea} ideaKey={key} className="flex-1" />
        )}
      </div>
    </Card>
  );
}

/** Three idea cards in a row (a column on phones) and the follow-up chips. */
export function MealIdeasBlock({ id, initial }: { id: string; initial?: MealIdeas | undefined }) {
  const { data } = useMealIdeas(id, initial);
  const { send, busy } = useContext(CoachFoodContext);
  if (!data) return <Card className="h-40 animate-pulse">{null}</Card>;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        {data.ideas.map((idea, i) => (
          <IdeaCard key={i} idea={idea} ideasId={data.id} index={i} picked={data.picked.includes(i)} />
        ))}
      </div>
      {data.followUps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.followUps.map((f) => (
            <button
              key={f}
              type="button"
              disabled={busy}
              onClick={() => send(f)}
              className="min-h-8 rounded-full border border-line-strong bg-surface px-3 text-[13px] text-ink mobile:min-h-[40px]"
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "✓ Logged 1.5 servings · 1,080 kcal to Dinner · Sun Nov 1 — see day" */
export function LoggedPill({ log }: { log: RecipeDraft['logged'][number] }) {
  return (
    <div className="flex items-center gap-2 self-start rounded-full border border-[#B7E4C7] bg-[#F0FAF3] px-3 py-1.5 text-[13px]">
      <CheckIcon className="text-success" />
      <span>
        Logged {servingsText(log.quantity)} · {fmtKcal(log.kcal)} kcal to {log.slot} · {formatLongDay(log.date)} —{' '}
        <Link to="/calendar/$date" params={{ date: log.date }} className="text-accent-ink">
          see day
        </Link>
      </span>
    </div>
  );
}

/**
 * The coach can't log food, so it hands over: Log this opens the food logger on the athlete's words, and
 * the fixed line teaches the way that skips the coach. Fixed so the path is never misremembered.
 */
export function FoodLogOfferBlock({ phrase }: { phrase: string }) {
  const { logWords } = useContext(CoachFoodContext);
  return (
    <Card className="flex flex-col items-start gap-2.5 self-start p-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] bg-[#FFF4E5] text-[#B54708]">
          <ForkKnifeIcon size={17} />
        </span>
        <span className="min-w-0 font-semibold break-words">{phrase}</span>
      </div>
      <Button variant="primary" size="sm" onClick={() => logWords(phrase)}>
        Log this
      </Button>
      <p className="m-0 text-xs text-muted">Quicker next time: open a day in Calendar, tap + Food, then Log with AI. It skips the coach, so it's faster and uses less AI.</p>
    </Card>
  );
}

/** The compact recipe card in the thread; the recipe itself opens in the pane. */
export function RecipeRefBlock({ id, initial }: { id: string; initial?: RecipeDraft | undefined }) {
  const { data } = useRecipeDraft(id, initial);
  const { openRecipe, openId } = useContext(CoachFoodContext);
  if (!data) return <Card className="h-16 animate-pulse">{null}</Card>;
  const per = data.totals.perServing;
  const open = openId === id;
  return (
    <>
      <button
        type="button"
        onClick={() => openRecipe(id)}
        aria-pressed={open}
        className={`flex items-center gap-3 self-start rounded-[12px] border bg-surface px-3.5 py-2.5 text-left text-ink ${open ? 'border-accent-ring' : 'border-line hover:bg-surface-2'}`}
      >
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] bg-[#FFF4E5] text-[#B54708]">
          <ForkKnifeIcon size={17} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{data.name}</span>
          <span className="text-xs text-muted">
            {servingsText(data.servings)} · {data.totals.unresolved ? '≈ ' : ''}
            {fmtKcal(per.kcal)} kcal each{data.minutes ? ` · ${data.minutes} min` : ''}
            {data.recipeId ? ' · saved' : ''}
          </span>
        </span>
        <ChevronRight className="ml-2 flex-none text-muted" />
      </button>
      {data.logged.map((l) => (
        <LoggedPill key={l.entryId} log={l} />
      ))}
    </>
  );
}
