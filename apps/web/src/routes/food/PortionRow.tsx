import { computePortion, unitsFor, type Loggable } from '@cycling-coach/core';
import type { Portion } from '@cycling-coach/shared';
import { XIcon } from '../../components/icons';
import { convertPortion } from '../../components/PortionPicker';
import { inputCls } from '../../components/ui';
import { fmtKcal } from '../../lib/food';
import { SourceTag } from './SourceTag';

/**
 * One ingredient / meal item: name, amount, unit (converting), kcal, remove. On a phone the name gets
 * its own line, so it's never cut to "Garlic, r…" (DECISIONS #108). A recipe's own name for the line
 * (`label`, "green beans") leads, with the food under it when that's different.
 */
export function PortionRow({
  item,
  name,
  label,
  portion,
  onChange,
  onRemove,
}: {
  item: Loggable | undefined;
  name: string;
  label?: string | undefined;
  portion: Portion;
  onChange: (p: Portion) => void;
  onRemove: () => void;
}) {
  const priced = item ? computePortion(item, portion.quantity, portion.unit) : null;
  const foodName = item?.name ?? name;
  const title = label ?? foodName;
  const sub = label && item && label.toLowerCase() !== item.name.toLowerCase() ? item.name : null;
  return (
    <div className="flex items-center gap-2 border-b border-divider py-2 last:border-b-0 mobile:flex-wrap mobile:gap-y-1.5">
      <div className="min-w-0 flex-auto mobile:basis-full">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium mobile:whitespace-normal mobile:text-[14px]">{title}</span>
          {item && <SourceTag source={item.source} />}
        </div>
        {sub && <div className="truncate text-xs text-muted mobile:whitespace-normal">{sub}</div>}
        {!item && <div className="text-xs text-danger">No longer in your foods</div>}
        {item && !priced && <div className="text-xs text-danger">Can't be measured in {portion.unit}</div>}
      </div>
      <input
        aria-label={`Amount of ${title}`}
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
        aria-label={`Unit for ${title}`}
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
      <span className="w-12 text-right font-mono text-[13px] mobile:ml-auto mobile:w-auto">
        {priced ? fmtKcal(priced.nutrients.kcal) : '—'}
        <span className="desktop:hidden"> kcal</span>
      </span>
      <button type="button" aria-label={`Remove ${title}`} onClick={onRemove} className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-2">
        <XIcon />
      </button>
    </div>
  );
}
