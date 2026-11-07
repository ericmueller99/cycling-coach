import { estimateAmount, estimateConfidence, estimateItemTotals, estimateStep, estimateTotals, formatPortion, otherSizeHint, setEstimateAmount } from '@cycling-coach/core';
import type { EstimateItem } from '@cycling-coach/shared';
import { Chip, Stepper } from '../../components/ui';
import { XIcon } from '../../components/icons';
import { AMBER, fmtKcal } from '../../lib/food';

const fmtG = (n: number | undefined) => `${Math.round(n ?? 0)} g`;

/** "Top sirloin, 8 oz" or "Garlic mashed potatoes, ½ side". One of something needs no amount. */
export function itemTitle(item: EstimateItem): string {
  const size = item.sizes[item.size]?.label;
  if (size) return `${item.name}, ${size}`;
  const amount = estimateAmount(item);
  return amount === 1 ? item.name : `${item.name}, ${formatPortion(amount, item.unit)}`;
}

const CONFIDENCE = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const;

/** The header: every number here is the sum of the cards below it. */
export function EstimateHeader({ items, left, isToday }: { items: readonly EstimateItem[]; left: number | null; isToday: boolean }) {
  const { low, high, nutrients } = estimateTotals(items);
  const confidence = estimateConfidence(nutrients.kcal, { low, high });
  const from = low * 0.85;
  const span = high * 1.1 - from || 1;
  const at = (n: number) => `${((n - from) / span) * 100}%`;
  const budget = isToday ? 'today’s budget' : 'this day’s budget';
  return (
    <section aria-label="The estimate" className="flex flex-col gap-2.5 rounded-2xl border border-[#D6E8A6] bg-[#F4FADF] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-[0.06em] text-[#3F6212]">ESTIMATE</span>
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: AMBER.bg, color: AMBER.fg }}>
          {CONFIDENCE[confidence]}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[36px] leading-none font-semibold tracking-[-0.02em]">≈ {fmtKcal(nutrients.kcal)}</span>
        <span className="text-[15px] text-[#3A414D]">kcal</span>
      </div>
      <div className="flex flex-col gap-1">
        <div aria-hidden="true" className="relative h-2 rounded-full bg-[#E5E8EC]">
          <span className="absolute inset-y-0 rounded-full bg-[#C8F25A]" style={{ left: at(low), width: `${((high - low) / span) * 100}%` }} />
          <span className="absolute -top-[3px] h-3.5 w-[3px] rounded-sm bg-ink" style={{ left: at(nutrients.kcal) }} />
        </div>
        <div className="flex justify-between font-mono text-xs text-muted">
          <span>likely {fmtKcal(low)}</span>
          <span>to {fmtKcal(high)}</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-xs text-muted">
        {(
          [
            ['Protein', nutrients.protein],
            ['Carbs', nutrients.carbs],
            ['Fat', nutrients.fat],
            ['Alcohol', nutrients.alcohol],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            {label}
            <div className="font-mono text-sm font-semibold text-ink">{fmtG(value)}</div>
          </div>
        ))}
      </div>
      {left != null && (
        <div className="border-t border-[#D6E8A6] pt-2.5 text-[13px] text-[#3A414D]">
          {left >= 0 ? (
            <>
              Leaves about <strong>{fmtKcal(left)} kcal</strong> in {budget}.
            </>
          ) : (
            <>
              About <strong>{fmtKcal(-left)} kcal</strong> over {budget}.
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ItemCard({ item, mobile, onChange, onRemove }: { item: EstimateItem; mobile: boolean; onChange: (next: EstimateItem) => void; onRemove: (() => void) | null }) {
  const { low, high, nutrients } = estimateItemTotals(item);
  const hint = item.assumed ? otherSizeHint(item) : null;
  const toggleMod = (i: number) => onChange({ ...item, mods: item.mods.includes(i) ? item.mods.filter((x) => x !== i) : [...item.mods, i] });
  return (
    <li className={`flex flex-col gap-2 rounded-[14px] border px-3.5 py-3 ${item.assumed ? 'border-dashed border-[#E8A33D] bg-[#FFFAF0]' : 'border-line bg-surface'}`}>
      <div className="flex items-start justify-between gap-2">
        <strong className="min-w-0">{itemTitle(item)}</strong>
        <span className="flex flex-none items-center gap-1">
          <span className="font-mono font-semibold">≈ {fmtKcal(nutrients.kcal)}</span>
          {onRemove && (
            <button type="button" aria-label={`Remove ${item.name}`} onClick={onRemove} className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-2 mobile:h-11 mobile:w-11">
              <XIcon />
            </button>
          )}
        </span>
      </div>
      {item.assumed ? (
        <div className="text-xs" style={{ color: AMBER.fg }}>
          {item.assumed}.{hint ? ` ${hint}.` : ''} {fmtKcal(low)}–{fmtKcal(high)}
        </div>
      ) : (
        <div className="text-xs text-muted">
          {item.why ? `${item.why} · ` : ''}
          {fmtKcal(low)}–{fmtKcal(high)}
        </div>
      )}
      {item.sizes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {item.sizes.map((s, i) => (
            <Chip key={s.label} mobile={mobile} on={i === item.size} onClick={() => onChange({ ...item, size: i, qty: 1, assumed: '' })}>
              {s.label}
            </Chip>
          ))}
        </div>
      ) : (
        <Stepper label={item.name} value={estimateAmount(item)} step={estimateStep(item)} min={estimateStep(item)} onChange={(v) => onChange(setEstimateAmount(item, v))}>
          <span className="min-w-16 text-center font-mono text-[13px] font-semibold">{formatPortion(estimateAmount(item), item.unit)}</span>
        </Stepper>
      )}
      {item.modifiers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.modifiers.map((mod, i) => (
            <Chip key={mod.label} mobile={mobile} on={item.mods.includes(i)} onClick={() => toggleMod(i)}>
              {mod.label}
            </Chip>
          ))}
        </div>
      )}
    </li>
  );
}

/** One card per item. The last one can't be removed: that's Remove on the entry, or closing the dialog. */
export function EstimateItems({ items, mobile, onChange }: { items: readonly EstimateItem[]; mobile: boolean; onChange: (items: EstimateItem[]) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((item, i) => (
        <ItemCard
          // By position: a rename from "Anything different?" shouldn't look like a new card.
          key={i}
          item={item}
          mobile={mobile}
          onChange={(next) => onChange(items.map((x, j) => (j === i ? next : x)))}
          onRemove={items.length > 1 ? () => onChange(items.filter((_, j) => j !== i)) : null}
        />
      ))}
    </ul>
  );
}
