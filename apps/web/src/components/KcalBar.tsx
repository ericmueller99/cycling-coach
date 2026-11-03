/** The over-budget colour on every kcal bar and label (`--color-danger`). */
export const OVER = '#B42318';

/**
 * Eaten vs budget. Under budget, one fill at eaten / budget. Over it, the bar stands
 * for everything eaten: `fill` up to the budget, then red for the overage, in proportion.
 */
export function KcalBar({
  eaten,
  budget,
  fill = 'var(--color-accent-ink)',
  track = 'var(--color-hover)',
  className = 'h-1 rounded-[2px]',
}: {
  eaten: number;
  budget: number;
  fill?: string;
  track?: string;
  className?: string;
}) {
  const b = Math.max(1, budget);
  const over = eaten > b;
  const fillPct = over ? (b / eaten) * 100 : Math.min(100, (Math.max(0, eaten) / b) * 100);
  return (
    <span className={`flex overflow-hidden ${className}`} style={{ background: track }} aria-hidden="true">
      {fillPct > 0 && <span className="block h-full" style={{ width: `${fillPct}%`, background: fill }} />}
      {over && <span className="block h-full grow" style={{ background: OVER }} />}
    </span>
  );
}
