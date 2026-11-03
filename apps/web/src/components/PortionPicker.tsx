import {
  amountPerServing,
  canonicalUnit,
  computePortion,
  formatQuantity,
  portionHintText,
  isMassUnit,
  isVolumeUnit,
  roundTo,
  unitsFor,
  type Loggable,
} from '@cycling-coach/core';
import type { Portion, PortionHint } from '@cycling-coach/shared';
import { useEffect, useId, useState } from 'react';
import { fmtG, fmtKcal } from '../lib/food';
import { Stepper, inputCls } from './ui';

const CHIPS = [0.25, 0.5, 0.75, 1, 1.5, 2];

/** Weights and volumes are typed as numbers ("100 g"); the chips then mean fractions of a serving. */
const isMeasured = (u: string) => (isMassUnit(u) || isVolumeUnit(u)) && !['cup', 'tbsp', 'tsp'].includes(u);

const stepFor = (u: string) => (u === 'g' || u === 'ml' ? 5 : u === 'oz' || u === 'fl_oz' ? 0.5 : u === 'kg' || u === 'l' || u === 'lb' ? 0.05 : 0.25);

/** Keep the same amount of food when the unit changes: 1 bagel → 95 g. */
export function convertPortion(item: Pick<Loggable, 'measures'>, from: Portion, toUnit: string): Portion {
  const servingsNow = from.quantity / (amountPerServing(item, from.unit) ?? 1);
  const per = amountPerServing(item, toUnit);
  if (!per) return { quantity: 1, unit: toUnit };
  const q = servingsNow * per;
  return { quantity: isMeasured(toUnit) ? roundTo(q, 1) : roundTo(q, 2), unit: toUnit };
}


/**
 * The portion control: quick chips, a stepper around a free number, the unit, the
 * "= 1½ × 1 bagel · 143 g" line and the live numbers. Any decimal works; the maths is core's.
 */
export function PortionPicker({
  item,
  value,
  onChange,
  hint,
  compact = false,
}: {
  item: Loggable;
  value: Portion;
  onChange: (p: Portion) => void;
  hint?: PortionHint | undefined;
  /** Smaller numbers block (words-log cards). */
  compact?: boolean;
}) {
  const qtyId = useId();
  const unitId = useId();
  const unit = canonicalUnit(value.unit);
  const units = unitsFor(item);
  if (!units.includes(unit)) units.unshift(unit);
  const measured = isMeasured(unit);
  const perServing = amountPerServing(item, unit);
  const result = computePortion(item, value.quantity, unit);

  // The text box keeps what's typed ("1." mid-edit) and only reports valid numbers.
  const [text, setText] = useState(String(value.quantity));
  useEffect(() => {
    if (Number(text) !== value.quantity) setText(String(value.quantity));
  }, [value.quantity]);

  const chipQty = (f: number) => (measured && perServing ? roundTo(f * perServing, 1) : f);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">Portion</span>
        {hint && <span className="text-xs text-muted">{portionHintText(hint)}</span>}
      </div>
      <div role="group" aria-label={measured ? 'Fractions of a serving' : 'Quick amounts'} className="grid grid-cols-6 gap-1.5 mobile:grid-cols-3">
        {CHIPS.map((f) => {
          const q = chipQty(f);
          const on = Math.abs(value.quantity - q) < 1e-6;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ quantity: q, unit })}
              className={`min-h-9 rounded-lg border font-mono text-[13px] mobile:min-h-12 ${on ? 'border-ink bg-ink font-semibold text-white' : 'border-line-strong bg-surface text-ink'}`}
            >
              {f}
              {measured && <span className={`block text-[10px] leading-none ${on ? 'text-white/70' : 'text-muted'}`}>{fmtG(q)} {unit}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Stepper label="quantity" value={value.quantity} step={stepFor(unit)} onChange={(q) => q > 0 && onChange({ quantity: roundTo(q, 3), unit })}>
          <label htmlFor={qtyId} className="sr-only">
            Quantity
          </label>
          <input
            id={qtyId}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(n) && n > 0) onChange({ quantity: n, unit });
            }}
            className={`${inputCls} w-24 text-center font-mono`}
          />
        </Stepper>
        <label htmlFor={unitId} className="sr-only">
          Unit
        </label>
        <select id={unitId} value={unit} onChange={(e) => onChange(convertPortion(item, value, e.target.value))} className={`${inputCls} min-w-28 flex-auto`}>
          {units.map((u) => (
            <option key={u} value={u}>
              {u === 'fl_oz' ? 'fl oz' : u === 'serving' && item.servingLabel ? `serving (${item.servingLabel})` : u}
            </option>
          ))}
        </select>
      </div>
      {result ? (
        <div className="text-xs text-muted">
          = {formatQuantity(roundTo(result.servings, 2))} × {item.servingLabel ?? '1 serving'}
          {result.grams != null && unit !== 'g' ? ` · ${Math.round(result.grams)} g` : ''}
        </div>
      ) : (
        <div className="text-xs text-danger">This food can't be measured in {unit}.</div>
      )}
      {result && (
        <div className={`flex items-center gap-4 rounded-[10px] bg-surface-2 ${compact ? 'px-3 py-2' : 'p-3'}`}>
          <div className="flex items-baseline gap-1">
            <span className={`font-mono font-semibold ${compact ? 'text-lg' : 'text-[26px] leading-none'}`}>{fmtKcal(result.nutrients.kcal)}</span>
            <span className="text-xs text-muted">kcal</span>
          </div>
          <div className="grid flex-auto grid-cols-3 gap-2 text-center">
            {(
              [
                ['Protein', result.nutrients.protein],
                ['Carbs', result.nutrients.carbs],
                ['Fat', result.nutrients.fat],
              ] as const
            ).map(([label, v]) => (
              <div key={label}>
                <div className="text-[11px] text-muted">{label}</div>
                <div className="font-mono text-[13px] font-semibold">{fmtG(v)} g</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
