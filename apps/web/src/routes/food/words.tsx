import { computePortion, foodAsLoggable, foodFromStaple, defaultPortionIndex, mealTotal, roundTo, stapleCovers, stapleWords, startingPortion, unitsFor, usageKey, type Loggable } from '@cycling-coach/core';
import type { Food, FoodLibrary, FoodLogInput, FoodParseResult, IsoDate, Nutrients, WordsItem, WordsRef } from '@cycling-coach/shared';
import { useMemo, useState } from 'react';
import { XIcon } from '../../components/icons';
import { convertPortion } from '../../components/PortionPicker';
import { Button, ErrorNote, Stepper, inputCls } from '../../components/ui';
import { api, unwrap } from '../../lib/api';
import { findLoggable, fmtKcal } from '../../lib/food';
import { useFoodMutations, useStapleDetail, useStapleSearch } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { SourceTag } from './SourceTag';

/**
 * "Log with AI" pieces shared by the Log food dialog and the log bar's confirmation
 * (WordsDialog): the parse call, one card per heard item, the log entries, and recent phrases. The
 * model only ever matches the user's own catalog; a miss is shown, never guessed.
 */

export type Line = WordsItem & { key: number };
export type Find = (kind: 'food' | 'recipe', id: string) => Loggable | undefined;

/** A lookup over the library plus foods saved in this dialog that the refetch hasn't brought yet. */
export function useFind(lib: FoodLibrary): { find: Find; addFood: (f: Food) => void } {
  const [extra, setExtra] = useState<Food[]>([]);
  const find = useMemo<Find>(() => {
    const byId = new Map(extra.map((f) => [f.id, f]));
    return (kind, id) => {
      const hit = findLoggable(lib, kind, id);
      if (hit || kind !== 'food') return hit;
      const f = byId.get(id);
      return f ? foodAsLoggable(f) : undefined;
    };
  }, [lib, extra]);
  return { find, addFood: (f) => setExtra((xs) => [...xs, f]) };
}

export async function parseWords(body: { phrase: string; date: IsoDate; slot: string; draft?: Line[] | undefined }): Promise<FoodParseResult> {
  const { phrase, date, slot, draft } = body;
  return unwrap(
    await api.api.food.parse.$post({
      json: { phrase, date, slot, ...(draft ? { draft: draft.map(({ heard, match, quantity, unit }) => ({ heard, match, quantity, unit })) } : {}) },
    }),
  );
}

export const linesFrom = (r: FoodParseResult): Line[] => r.items.map((it, i) => ({ ...it, key: Date.now() + i }));

export function portionOf(lib: FoodLibrary, find: Find, line: Line): { kcal: number; nutrients: Nutrients | null } {
  if (!line.match) return { kcal: 0, nutrients: null };
  if (line.match.kind === 'meal') {
    const meal = lib.meals.find((m) => m.id === line.match!.id);
    const n = meal ? mealTotal(meal.items, (k, id) => find(k, id), line.quantity) : null;
    return { kcal: n?.kcal ?? 0, nutrients: n };
  }
  const item = find(line.match.kind, line.match.id);
  const p = item ? computePortion(item, line.quantity, line.unit) : null;
  return { kcal: p?.nutrients.kcal ?? 0, nutrients: p?.nutrients ?? null };
}

/** The log entries for the matched lines — a saved meal logs each of its items. */
export function wordsEntries(lib: FoodLibrary, lines: Line[], at: { date: IsoDate; slot: string; time: string }): FoodLogInput[] {
  const entries: FoodLogInput[] = [];
  for (const l of lines) {
    if (!l.match) continue;
    if (l.match.kind === 'meal') {
      const meal = lib.meals.find((x) => x.id === l.match!.id);
      for (const it of meal?.items ?? []) entries.push({ ...at, kind: it.kind, refId: it.refId, quantity: roundTo(it.quantity * l.quantity, 3), unit: it.unit, via: 'words', fromMealId: meal!.id });
    } else entries.push({ ...at, kind: l.match.kind, refId: l.match.id, quantity: l.quantity, unit: l.unit, via: 'words' });
  }
  return entries;
}

/** Swap the match for one of the alternatives, at that food's usual portion. */
function AltChips({ line, lib, find, slot, onChange, label }: { line: Line; lib: FoodLibrary; find: Find; slot: string; onChange: (l: Line) => void; label: string }) {
  const pick = (alt: WordsRef) => {
    const rest = [...line.alternatives.filter((a) => a.id !== alt.id), ...(line.match ? [line.match] : [])];
    if (alt.kind === 'meal') return onChange({ ...line, match: alt, alternatives: rest, quantity: 1, unit: 'serving', why: 'The whole saved meal' });
    const item = find(alt.kind, alt.id);
    const start = item ? startingPortion(item, lib.usage[usageKey(alt.kind, alt.id)], slot) : { quantity: 1, unit: 'serving' };
    onChange({ ...line, match: alt, alternatives: rest, quantity: start.quantity, unit: start.unit, why: 'Usual portion' });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">{label}</span>
      {line.alternatives.map((a) => (
        <button key={`${a.kind}:${a.id}`} type="button" onClick={() => pick(a)} className="min-h-8 rounded-full border border-line-strong bg-surface px-2.5 text-[13px] text-ink">
          {a.name}
        </button>
      ))}
    </div>
  );
}

/** A matched item: name + source, what was heard and why this portion, kcal, ± amount × unit, alternatives. */
export function WordsCard({
  lib,
  find,
  line,
  slot,
  slotPill,
  onChange,
  onRemove,
}: {
  lib: FoodLibrary;
  find: Find;
  line: Line;
  slot: string;
  /** The phrase named a different slot than the dialog's ("…for breakfast"). */
  slotPill?: string | undefined;
  onChange: (l: Line) => void;
  onRemove: () => void;
}) {
  const match = line.match!;
  const { kcal } = portionOf(lib, find, line);
  const isMeal = match.kind === 'meal';
  const item = isMeal ? undefined : find(match.kind as 'food' | 'recipe', match.id);
  const source = isMeal ? 'meal' : (item?.source ?? (match.kind === 'recipe' ? 'recipe' : null));
  const measured = line.unit === 'g' || line.unit === 'ml';
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-auto">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold">
            <span className="min-w-0">{match.name}</span>
            {source && <SourceTag source={source} />}
          </div>
          <div className="text-xs text-muted">
            heard “{line.heard}”{line.why ? ` · ${line.why}` : ''}
          </div>
        </div>
        <span className="font-mono text-[13px] font-semibold">{fmtKcal(kcal)}</span>
        <button type="button" aria-label={`Remove ${match.name}`} onClick={onRemove} className="-mt-1 -mr-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-2">
          <XIcon />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Stepper label={match.name} value={line.quantity} step={measured ? 5 : 0.25} onChange={(q) => q > 0 && onChange({ ...line, quantity: roundTo(q, 3) })}>
          <input
            aria-label={`Amount of ${match.name}`}
            inputMode="decimal"
            key={line.quantity}
            defaultValue={String(line.quantity)}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) onChange({ ...line, quantity: n });
            }}
            className={`${inputCls} min-h-9 w-20 text-center font-mono`}
          />
        </Stepper>
        {isMeal ? (
          <span className="text-[13px] text-muted">× the meal</span>
        ) : (
          item && (
            <select aria-label="Unit" value={line.unit} onChange={(e) => onChange({ ...line, ...convertPortion(item, line, e.target.value) })} className={`${inputCls} min-h-9 w-32`}>
              {[...new Set([line.unit, ...unitsFor(item)])].map((u) => (
                <option key={u} value={u}>
                  {u === 'fl_oz' ? 'fl oz' : u}
                </option>
              ))}
            </select>
          )
        )}
        {slotPill && <span className="rounded-full bg-accent-tint px-2 py-0.5 text-xs font-medium text-accent-ink">→ {slotPill}</span>}
      </div>
      {line.alternatives.length > 0 && <AltChips line={line} lib={lib} find={find} slot={slot} onChange={onChange} label="Not this?" />}
    </div>
  );
}

/** "Use staple: Banana, raw · 105" — the top Canadian match, saved to the user's foods only on click. */
function UseStaple({ heard, onSaved }: { heard: string; onSaved: (food: Food) => void }) {
  const m = useFoodMutations();
  const [error, setError] = useState<string | null>(null);
  // "a banana" → "banana": the staple ranking reads every word, filler included.
  const search = useStapleSearch(stapleWords(heard).join(' ') || heard, 'cnf');
  const top = search.data?.results[0];
  const hit = top && stapleCovers(heard, top.name) ? top : undefined;
  const detail = useStapleDetail(hit?.source ?? 'cnf', hit?.ref);
  const input = useMemo(() => (detail.data ? foodFromStaple(detail.data, { name: hit!.name, defaultIndex: defaultPortionIndex(detail.data.portions) }) : null), [detail.data, hit]);
  if (!hit || !input) return null;
  const kcal = computePortion(input, input.defaultPortion.quantity, input.defaultPortion.unit)?.nutrients.kcal;
  return (
    <>
      <Button size="sm" className="h-auto max-w-full py-1.5 text-left" disabled={m.createFood.isPending} onClick={() => m.createFood.mutate(input, { onSuccess: onSaved, onError: (e) => setError(errorMessage(e)) })}>
        Use staple: {hit.name}
        {kcal != null ? ` · ${fmtKcal(kcal)}` : ''}
      </Button>
      {error && <ErrorNote>{error}</ErrorNote>}
    </>
  );
}

/** Something heard that isn't in the user's foods: never guessed, not logged unless they resolve it. */
export function WordsMissCard({
  lib,
  find,
  line,
  slot,
  staplesOn,
  onChange,
  onRemove,
  onFoodSaved,
  addNew,
}: {
  lib: FoodLibrary;
  find: Find;
  line: Line;
  slot: string;
  staplesOn: boolean;
  onChange: (l: Line) => void;
  onRemove: () => void;
  /** A staple was saved for this line — it becomes a match at the food's usual portion. */
  onFoodSaved: (food: Food) => void;
  addNew: { photo?: (() => void) | undefined; manual?: ((name: string) => void) | undefined };
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-dashed border-[#E9B98A] bg-[#FFFBF5] p-3">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="flex-auto">
          <strong>“{line.heard}”</strong> isn't in your foods
        </span>
        <span className="rounded bg-[#FFF4E5] px-1.5 text-[11px] font-bold text-[#9A5B13]">Not logged</span>
      </div>
      {line.alternatives.length > 0 && <AltChips line={line} lib={lib} find={find} slot={slot} onChange={onChange} label="Did you mean" />}
      <div className="flex flex-wrap gap-2">
        {staplesOn && <UseStaple heard={line.heard} onSaved={onFoodSaved} />}
        {addNew.photo && (
          <Button size="sm" onClick={addNew.photo}>
            Add from photo
          </Button>
        )}
        {addNew.manual && (
          <Button size="sm" onClick={() => addNew.manual!(line.heard)}>
            Enter manually
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Skip
        </Button>
      </div>
    </div>
  );
}

/** A miss resolved with a newly saved food: matched at its usual portion. */
export const lineWithFood = (line: Line, food: Food): Line => ({
  ...line,
  match: { kind: 'food', id: food.id, name: food.name },
  quantity: food.defaultPortion.quantity,
  unit: food.defaultPortion.unit,
  why: 'staple · saved to your foods',
});

// ── Recent phrases (this device) ───────────────────────────────────────────

const RECENT_KEY = 'food.ai.recent';
export interface RecentPhrase {
  text: string;
  /** ISO timestamp. */
  at: string;
  kcal: number;
}

export function readRecentPhrases(): RecentPhrase[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as RecentPhrase[]).filter((r) => typeof r?.text === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberPhrase(text: string, kcal: number, now: Date) {
  try {
    const rest = readRecentPhrases().filter((r) => r.text.toLowerCase() !== text.toLowerCase());
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ text, at: now.toISOString(), kcal: Math.round(kcal) }, ...rest].slice(0, 5)));
  } catch {
    /* private mode */
  }
}

/** "Today 7:40", "Yesterday", "Fri", "Oct 12". */
export function whenLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
