import { applyNutrientChanges } from '@cycling-coach/core';
import { nutrientKeys, type FoodAdjustment, type NutrientKey, type Nutrients } from '@cycling-coach/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, SendIcon } from '../../components/icons';
import { Button, ErrorNote, errorContent, inputCls } from '../../components/ui';
import { NUTRIENT_ROWS } from '../../lib/food';
import { useAdjustFood } from '../../lib/foodQueries';
import type { FoodDraft } from './FoodForm';

/** The API takes this many earlier turns; older ones drop off the front. */
const MAX_TURNS = 12;
const MAX_NOTES = 500;

type Turn = { role: 'user'; text: string } | { role: 'assistant'; text: string; adjustment: FoodAdjustment; applied: boolean };

/** The form's values that are numbers. Blank or half-typed ones aren't there to adjust. */
function draftNutrients(draft: FoodDraft): Partial<Nutrients> {
  const out: Partial<Nutrients> = {};
  for (const k of nutrientKeys) {
    const raw = draft.nutrients[k]?.trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

/** A proposal applied to the form: new values and name, a line in the notes, and what to flag for a check. */
export function withAdjustment(draft: FoodDraft, a: FoodAdjustment): { draft: FoodDraft; changed: NutrientKey[] } {
  const { applied } = applyNutrientChanges(draftNutrients(draft), a.changes);
  const note = a.note.trim();
  return {
    draft: {
      ...draft,
      name: a.name.trim() || draft.name,
      nutrients: { ...draft.nutrients, ...Object.fromEntries(applied.map((c) => [c.nutrient, String(c.to)])) },
      notes: note ? [draft.notes.trim(), note].filter(Boolean).join(' ').slice(0, MAX_NOTES) : draft.notes,
    },
    changed: applied.map((c) => c.nutrient),
  };
}

const rowOf = (k: NutrientKey) => NUTRIENT_ROWS.find((r) => r.key === k)!;

/** Old → new for each value, worked out from the form as it stands, with Apply. */
function Proposal({ draft, adjustment, applied, onApply }: { draft: FoodDraft; adjustment: FoodAdjustment; applied: boolean; onApply: () => void }) {
  const changes = applyNutrientChanges(draftNutrients(draft), adjustment.changes).applied;
  // Once applied the form already holds the new values, so there's nothing left to compare.
  if (!applied && !changes.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3">
      {applied ? (
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-accent-ink">
          <CheckIcon /> Applied. The changed values are amber on Details.
        </div>
      ) : (
        <>
          {adjustment.name.trim() && adjustment.name.trim() !== draft.name.trim() && (
            <div className="text-[13px]">
              <span className="text-muted">Name: </span>
              {adjustment.name.trim()}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {changes.map((c) => {
              const row = rowOf(c.nutrient);
              return (
                <div key={c.nutrient} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span>{row.label}</span>
                  <span className="font-mono">
                    {c.from} → <strong>{c.to}</strong> <span className="text-xs text-muted">{row.unit}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">An estimate, not from the label.</span>
            <Button size="sm" variant="primary" onClick={onApply}>
              Apply
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Tell the small model how a food differs from its label ("no whipped cream"). It proposes changes
 * and the user applies them; nothing reaches the form otherwise, and nothing is saved here. The
 * conversation lives in this component and goes when the dialog closes.
 */
export function AdjustWithAi({ draft, onApply }: { draft: FoodDraft; onApply: (a: FoodAdjustment) => void }) {
  const adjust = useAdjustFood();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<ReactNode>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [turns.length, adjust.isPending]);

  const send = () => {
    const message = text.trim();
    if (message.length < 2 || adjust.isPending) return;
    setError(null);
    adjust.mutate(
      {
        food: {
          name: draft.name.trim(),
          ...(draft.brand.trim() ? { brand: draft.brand.trim() } : {}),
          ...(draft.servingLabel.trim() ? { servingLabel: draft.servingLabel.trim() } : {}),
          ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
          nutrients: draftNutrients(draft),
        },
        // The model needs to know which proposals are already in the values it's given.
        turns: turns.slice(-MAX_TURNS).map((t) => ({
          role: t.role,
          text: (t.role === 'assistant' && t.adjustment.changes.length ? `${t.text} [${t.applied ? 'Applied' : 'Not applied'}]` : t.text).slice(0, 2000),
        })),
        message,
      },
      {
        onSuccess: (adjustment) => {
          setTurns((ts) => [...ts, { role: 'user', text: message }, { role: 'assistant', text: adjustment.reply, adjustment, applied: false }]);
          setText('');
        },
        onError: (e) => setError(errorContent(e)),
      },
    );
  };

  const apply = (i: number, a: FoodAdjustment) => {
    onApply(a);
    setTurns((ts) => ts.map((t, j) => (j === i && t.role === 'assistant' ? { ...t, applied: true } : t)));
  };

  return (
    <div className="flex flex-col gap-3">
      {!turns.length && (
        <div className="text-[13px] text-muted">
          Tell it what was different about yours, like “no whipped cream” or “oat milk instead”. It estimates the change, and you decide whether to apply it.
        </div>
      )}
      {turns.map((t, i) =>
        t.role === 'user' ? (
          <div key={i} className="max-w-[85%] self-end rounded-[12px] bg-hover px-3 py-2 text-[13px]">
            {t.text}
          </div>
        ) : (
          <div key={i} className="flex flex-col gap-2">
            <div className="text-[13px]">{t.text}</div>
            {t.adjustment.changes.length > 0 && <Proposal draft={draft} adjustment={t.adjustment} applied={t.applied} onApply={() => apply(i, t.adjustment)} />}
          </div>
        ),
      )}
      {adjust.isPending && <div className="text-[13px] text-muted">Working it out…</div>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div ref={end} className="flex items-end gap-2">
        <textarea
          aria-label="What was different"
          rows={2}
          maxLength={500}
          value={text}
          placeholder="What was different about yours?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className={`${inputCls} min-h-16 flex-auto resize-none py-2`}
        />
        <Button variant="primary" aria-label="Send" disabled={text.trim().length < 2 || adjust.isPending} onClick={send}>
          <SendIcon />
        </Button>
      </div>
    </div>
  );
}
