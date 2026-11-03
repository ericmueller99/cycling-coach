import { computePortion, unitsFor, type Loggable } from '@cycling-coach/core';
import type { Portion } from '@cycling-coach/shared';
import { XIcon } from '../../components/icons';
import { convertPortion } from '../../components/PortionPicker';
import { inputCls } from '../../components/ui';
import { fmtKcal } from '../../lib/food';
import { SourceTag } from './SourceTag';

/** One ingredient / meal item: name, amount, unit (converting), kcal, remove. */
export function PortionRow({
  item,
  name,
  portion,
  onChange,
  onRemove,
}: {
  item: Loggable | undefined;
  name: string;
  portion: Portion;
  onChange: (p: Portion) => void;
  onRemove: () => void;
}) {
  const priced = item ? computePortion(item, portion.quantity, portion.unit) : null;
  return (
    <div className="flex items-center gap-2 border-b border-divider py-2 last:border-b-0">
      <div className="min-w-0 flex-auto">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{item?.name ?? name}</span>
          {item && <SourceTag source={item.source} />}
        </div>
        {!item && <div className="text-xs text-danger">No longer in your foods</div>}
        {item && !priced && <div className="text-xs text-danger">Can't be measured in {portion.unit}</div>}
      </div>
      <input
        aria-label={`Amount of ${item?.name ?? name}`}
        inputMode="decimal"
        defaultValue={String(portion.quantity)}
        key={`${portion.unit}:${portion.quantity}`}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0 && n !== portion.quantity) onChange({ ...portion, quantity: n });
        }}
        className={`${inputCls} min-h-9 w-20 text-right font-mono text-[13px]`}
      />
      <select
        aria-label="Unit"
        value={portion.unit}
        disabled={!item}
        onChange={(e) => item && onChange(convertPortion(item, portion, e.target.value))}
        className={`${inputCls} min-h-9 w-28 text-[13px]`}
      >
        {[...new Set([portion.unit, ...(item ? unitsFor(item) : [])])].map((u) => (
          <option key={u} value={u}>
            {u === 'fl_oz' ? 'fl oz' : u}
          </option>
        ))}
      </select>
      <span className="w-12 text-right font-mono text-[13px]">{priced ? fmtKcal(priced.nutrients.kcal) : '—'}</span>
      <button type="button" aria-label={`Remove ${item?.name ?? name}`} onClick={onRemove} className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-2">
        <XIcon />
      </button>
    </div>
  );
}
