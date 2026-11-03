import { defaultPortionIndex, draftRecipeView, foodFromStaple, formatLongDay, formatPortion, formatQuantity, unitsFor } from '@cycling-coach/core';
import type { DraftIngredient, FoodLibrary, IsoDate, RecipeDraft } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { ExpandIcon, PencilIcon, TrashIcon, XIcon } from '../../components/icons';
import { CookMode } from '../../components/recipe/CookMode';
import { ShareButton } from '../../components/recipe/ShareRecipe';
import { StepText } from '../../components/recipe/StepText';
import { ServingsPicker } from '../../components/ServingsPicker';
import { Sheet } from '../../components/Sheet';
import { Button, ErrorNote, inputCls, SectionLabel, Spinner } from '../../components/ui';
import { fmtG, fmtKcal } from '../../lib/food';
import { useFoodLibrary, useRecipeDraft, useRecipeDraftMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { ItemSearch } from '../food/ItemSearch';
import { SourceTag } from '../food/SourceTag';
import { LoggedPill } from './foodBlocks';
import { RIGHT_COL } from './rightColumn';

/**
 * The recipe pane: a coach recipe with its ingredients priced from the user's foods
 * and staples, the steps, and a pinned "How much did you eat?" block. Log saves it as a Library
 * recipe (plus any staples it uses) and logs the servings; Save as recipe only saves. Nothing is
 * written before one of those two clicks — fixing a line only edits the draft.
 */

const PRESETS = [0.5, 1, 1.25, 1.5, 2];

export function StapleTag() {
  return <span className="flex-none rounded-[5px] bg-[#ECFDF3] px-1.5 text-[10px] leading-[17px] font-bold text-[#085D3A]">Staple</span>;
}

/** Amount + unit for one line, with the units its match can measure in. */
function AmountEditor({ line, lib, onSave, busy }: { line: DraftIngredient; lib: FoodLibrary; onSave: (quantity: number, unit: string) => void; busy: boolean }) {
  const [q, setQ] = useState(String(line.quantity));
  const [unit, setUnit] = useState(line.unit);
  const m = line.match;
  const food = m?.kind === 'food' ? lib.foods.find((f) => f.id === m.foodId) : undefined;
  const units = food ? unitsFor(food) : m?.kind === 'staple' ? unitsFor(foodFromStaple(m.detail, { name: m.name, defaultIndex: defaultPortionIndex(m.detail.portions) })) : ['g', 'ml'];
  const options = units.includes(unit) ? units : [unit, ...units];
  const n = Number(q);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label={`Amount of ${line.name}`} inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} w-20`} />
      <select aria-label={`Unit for ${line.name}`} value={unit} onChange={(e) => setUnit(e.target.value)} className={`${inputCls} w-auto`}>
        {options.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={busy || !(n > 0)} onClick={() => onSave(n, unit)}>
        Update
      </Button>
    </div>
  );
}

function IngredientRow({
  line,
  index,
  lib,
  today,
  editing,
  draft,
}: {
  line: DraftIngredient;
  index: number;
  lib: FoodLibrary;
  today: IsoDate;
  editing: boolean;
  draft: RecipeDraft;
}) {
  const m = useRecipeDraftMutations(draft.id);
  const [open, setOpen] = useState<'pick' | 'amount' | null>(null);
  const busy = m.patch.isPending;
  const patch = (ingredient: NonNullable<Parameters<typeof m.patch.mutate>[0]['ingredient']>) => m.patch.mutate({ ingredient }, { onSuccess: () => setOpen(null) });
  const problem = line.problem;
  const amount = formatPortion(line.quantity, line.unit);

  let source: ReactNode = null;
  if (line.match?.kind === 'food') source = <SourceTag source={line.match.source} />;
  else if (line.match?.kind === 'staple') source = <StapleTag />;

  return (
    <li className={`flex flex-col gap-1.5 py-2.5 ${problem ? '-mx-2 rounded-[10px] border border-dashed border-[#E9B98A] bg-[#FFFBF5] px-2' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-auto flex-col">
          <span className={`flex items-center gap-1.5 text-[13.5px] ${line.toTaste ? 'text-muted' : 'font-medium'}`}>
            <span className="truncate">{line.match?.name ?? line.name}</span>
            {source}
          </span>
          <span className="text-xs text-muted">
            {line.toTaste
              ? 'to taste · not counted'
              : problem === 'unmatched'
                ? `“${line.name}” isn't in your foods · not counted`
                : problem === 'unit'
                  ? `${amount} doesn't fit this food · not counted`
                  : line.match?.kind === 'staple'
                    ? 'not in your foods · staple used'
                    : line.match && line.match.name !== line.name
                      ? `for “${line.name}”`
                      : ''}
          </span>
        </div>
        <span className="flex-none text-right font-mono text-xs">
          {!line.toTaste && amount}
          {line.kcal != null && <span className="block text-muted">{fmtKcal(line.kcal)} kcal</span>}
        </span>
      </div>
      {!draft.recipeId && (problem || editing) && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={problem === 'unmatched' ? 'primary' : 'secondary'} onClick={() => setOpen(open === 'pick' ? null : 'pick')} aria-expanded={open === 'pick'}>
            {line.match ? 'Change food' : 'Pick from my foods'}
          </Button>
          {line.match && !line.toTaste && (
            <Button size="sm" onClick={() => setOpen(open === 'amount' ? null : 'amount')} aria-expanded={open === 'amount'}>
              Amount
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ index, toTaste: !line.toTaste })}>
            {line.toTaste ? 'Count it' : 'To taste'}
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Remove ${line.name}`} disabled={busy || draft.ingredients.length === 1} onClick={() => patch({ index, remove: true })}>
            <TrashIcon />
          </Button>
        </div>
      )}
      {open === 'amount' && <AmountEditor line={line} lib={lib} busy={busy} onSave={(quantity, unit) => patch({ index, quantity, unit })} />}
      {open === 'pick' && (
        <ItemSearch
          lib={lib}
          today={today}
          kinds={['food']}
          placeholder={`Search your foods for “${line.name}”`}
          // Keep the coach's amount when the food measures in it; else start at the food's usual portion.
          onPick={(item, portion) => patch({ index, foodId: item.id, ...(item.kind === 'food' && unitsFor(item.food).includes(line.unit) ? {} : { quantity: portion.quantity, unit: portion.unit }) })}
          addNew={{
            target: 'recipe',
            onSaved: (food, portion, add) => {
              if (add) patch({ index, foodId: food.id, ...(unitsFor(food).includes(line.unit) ? {} : { quantity: portion.quantity, unit: portion.unit }) });
            },
          }}
        />
      )}
      {m.patch.error && <ErrorNote>{errorMessage(m.patch.error)}</ErrorNote>}
    </li>
  );
}

/** "How much did you eat?" — presets, slot, day, Log and Save as recipe. */
function LogBlock({ draft, lib, slot: initialSlot, date: initialDate }: { draft: RecipeDraft; lib: FoodLibrary; slot: string; date: IsoDate }) {
  const id = useId();
  const m = useRecipeDraftMutations(draft.id);
  const [q, setQ] = useState(1);
  const [custom, setCustom] = useState('');
  const [slot, setSlot] = useState(initialSlot);
  const [date, setDate] = useState(initialDate);
  const per = draft.totals.perServing;
  const blocked = draft.totals.unresolved > 0;
  const busy = m.log.isPending || m.save.isPending;
  const slots = lib.settings.slots.map((s) => s.name);
  const staples = draft.recipeId ? [] : draft.totals.staples;
  const error = m.log.error ?? m.save.error;
  const chip = (on: boolean) => `min-h-9 min-w-11 rounded-[9px] border px-2.5 font-mono text-[13px] ${on ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'}`;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">How much did you eat?</span>
        <span className="text-xs text-muted">
          {slot} · {formatLongDay(date)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Servings eaten">
        {PRESETS.map((v) => (
          <button key={v} type="button" aria-pressed={q === v && !custom} className={chip(q === v && !custom)} onClick={() => (setQ(v), setCustom(''))}>
            {formatQuantity(v)}
          </button>
        ))}
        <input
          aria-label="Other amount, servings"
          inputMode="decimal"
          placeholder="other"
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            const n = Number(e.target.value);
            if (n > 0 && n <= 20) setQ(n);
          }}
          className={`${inputCls} h-9 w-[72px] text-[13px]`}
        />
        <span className="ml-auto font-mono text-sm font-semibold">{fmtKcal(per.kcal * q)} kcal</span>
      </div>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`${id}-slot`}>
          Meal
        </label>
        <select id={`${id}-slot`} value={slot} onChange={(e) => setSlot(e.target.value)} className={`${inputCls} flex-1`}>
          {(slots.includes(slot) ? slots : [slot, ...slots]).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${id}-date`}>
          Day
        </label>
        <input id={`${id}-date`} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputCls} flex-1`} />
      </div>
      {blocked && <div className="text-xs text-[#9A5B13]">Pick a food for the highlighted ingredients (or remove them) to log or save.</div>}
      {staples.length > 0 && <div className="text-xs text-muted">Also saves to your foods: {staples.join(', ')}.</div>}
      <Button variant="primary" size="lg" disabled={blocked || busy} onClick={() => m.log.mutate({ quantity: q, slot, date })}>
        {m.log.isPending ? 'Logging…' : `Log ${formatQuantity(q)} serving${q === 1 ? '' : 's'} to ${slot}`}
      </Button>
      {draft.recipeId ? (
        <div className="text-center text-[13px] text-muted">
          Saved to your recipes —{' '}
          <Link to="/library/recipes/$id" params={{ id: draft.recipeId }} className="text-accent-ink">
            open the recipe
          </Link>
        </div>
      ) : (
        <Button disabled={blocked || busy} onClick={() => m.save.mutate()}>
          {m.save.isPending ? 'Saving…' : 'Save as recipe'}
        </Button>
      )}
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
    </div>
  );
}

function PaneBody({ draft, lib, today, editing }: { draft: RecipeDraft; lib: FoodLibrary; today: IsoDate; editing: boolean }) {
  const m = useRecipeDraftMutations(draft.id);
  const per = draft.totals.perServing;
  return (
    <>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xl font-semibold">
          {draft.totals.unresolved ? '≈ ' : ''}
          {fmtKcal(per.kcal)}
        </span>
        <span className="text-[13px] text-muted">kcal / serving</span>
        <span className="ml-auto font-mono text-xs text-muted">
          P {fmtG(per.protein)} · C {fmtG(per.carbs)} · F {fmtG(per.fat)} g
        </span>
      </div>
      {draft.description && <p className="m-0 text-[13px] text-muted">{draft.description}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>
          Ingredients · makes {formatQuantity(draft.servings)} serving{draft.servings === 1 ? '' : 's'}
        </SectionLabel>
        {/* Before it's saved, the servings scale every amount (DECISIONS #47); afterwards the recipe page does. */}
        {!draft.recipeId && <ServingsPicker label="Making" value={draft.servings} disabled={m.patch.isPending} onChange={(n) => m.patch.mutate({ servings: n })} />}
      </div>
      <ul className="m-0 flex list-none flex-col divide-y divide-divider p-0">
        {draft.ingredients.map((line, i) => (
          <IngredientRow key={`${i}-${line.name}`} line={line} index={i} lib={lib} today={today} editing={editing} draft={draft} />
        ))}
      </ul>
      <SectionLabel>Steps</SectionLabel>
      <ol className="m-0 flex flex-col gap-2 pl-5 text-[13.5px]">
        {draft.steps.map((s, i) => (
          <li key={i} className="[&_strong]:font-semibold">
            <StepText text={s} />
          </li>
        ))}
      </ol>
      {draft.logged.length > 0 && (
        <div className="flex flex-col gap-2">
          {draft.logged.map((l) => (
            <LoggedPill key={l.entryId} log={l} />
          ))}
        </div>
      )}
    </>
  );
}

export function RecipePane({
  draftId,
  initial,
  slot,
  date,
  today,
  mobile,
  onClose,
}: {
  draftId: string;
  initial?: RecipeDraft | undefined;
  /** Defaults for the log block, from the food strip. */
  slot: string;
  date: IsoDate;
  today: IsoDate;
  mobile: boolean;
  onClose: () => void;
}) {
  const { data: draft, error } = useRecipeDraft(draftId, initial);
  const { data: lib } = useFoodLibrary();
  const [editing, setEditing] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [cookFor, setCookFor] = useState<number | null>(null);
  const m = useRecipeDraftMutations(draftId);

  const title = draft?.name ?? 'Recipe';
  const editButton = draft && !draft.recipeId && (
    <Button size="sm" variant={editing ? 'primary' : 'ghost'} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
      <PencilIcon /> {editing ? 'Done' : 'Edit'}
    </Button>
  );
  const view = draft ? draftRecipeView(draft) : null;
  const tools = draft && (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => (setCookFor(null), setCooking(true))}>
        <ExpandIcon /> Full screen
      </Button>
      <ShareButton
        recipeId={draft.recipeId}
        prepare={async () => (await m.save.mutateAsync()).recipeId!}
        name={draft.name}
        share={null}
        disabled={!draft.recipeId && draft.totals.unresolved > 0}
      />
    </div>
  );
  const cook = cooking && view && (
    <CookMode view={view} servings={cookFor ?? view.servings} onServings={setCookFor} storageKey={`draft:${draftId}`} onClose={() => setCooking(false)} />
  );
  const body =
    error ? (
      <ErrorNote>{errorMessage(error)}</ErrorNote>
    ) : !draft || !lib ? (
      <Spinner />
    ) : (
      <>
        {tools}
        <PaneBody draft={draft} lib={lib} today={today} editing={editing} />
      </>
    );
  const footer = draft && lib ? <LogBlock key={`${slot}-${date}`} draft={draft} lib={lib} slot={slot} date={date} /> : null;

  if (mobile) {
    return (
      <>
        <Sheet title={title} tall onClose={onClose} action={editButton} footer={footer}>
          {body}
        </Sheet>
        {cook}
      </>
    );
  }
  return (
    <aside aria-label="Recipe" className={`flex flex-col border-l border-line bg-surface-alt ${RIGHT_COL}`}>
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <h2 className="m-0 min-w-0 flex-auto truncate text-[17px] font-semibold">{title}</h2>
        {editButton}
        <button type="button" aria-label="Close recipe" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-hover">
          <XIcon size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-auto flex-col gap-3.5 overflow-y-auto px-5 py-4">{body}</div>
      {footer && <div className="border-t border-line bg-surface px-5 pt-3.5 pb-5">{footer}</div>}
      {cook}
    </aside>
  );
}

/** The right column while the coach writes the recipe the user just asked for (DECISIONS #46). */
export function RecipePaneSkeleton() {
  return (
    <aside aria-label="Recipe" aria-busy="true" className={`flex flex-col border-l border-line bg-surface-alt ${RIGHT_COL}`}>
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
        <h2 className="m-0 text-[17px] font-semibold">Coach is writing the recipe…</h2>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="text-[13px] text-muted">Ingredients are matched to your foods and priced as it goes — about half a minute. You can leave this page; it keeps going.</div>
        {[70, 90, 55, 80, 65, 85].map((w, i) => (
          <div key={i} className="h-3.5 animate-pulse rounded bg-hover" style={{ width: `${w}%` }} />
        ))}
      </div>
    </aside>
  );
}
