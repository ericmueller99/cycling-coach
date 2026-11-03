import { formatQuantity } from '@cycling-coach/core';

/**
 * "Cooking for − 3 +" — how many servings to make (DECISIONS #47). Whole servings, 1 to `max`.
 * Used before the recipe is written (Make this), on the coach's recipe and on any recipe page.
 */
export function ServingsPicker({
  value,
  onChange,
  disabled,
  label = 'Cooking for',
  max = 12,
  size = 'sm',
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean | undefined;
  label?: string;
  max?: number;
  size?: 'sm' | 'lg';
}) {
  const btn = `flex flex-none items-center justify-center rounded-lg border border-line-strong bg-surface text-ink disabled:opacity-40 ${
    size === 'lg' ? 'h-11 w-11 text-lg' : 'h-8 w-8 mobile:h-10 mobile:w-10'
  }`;
  const down = Math.max(1, Math.ceil(value - 1 - 1e-9));
  const up = Math.min(max, Math.floor(value + 1 + 1e-9));
  return (
    <div className={`flex items-center gap-2 ${size === 'lg' ? 'text-[15px]' : 'text-[13px]'} text-muted`}>
      <span>{label}</span>
      <button type="button" aria-label="Fewer servings" className={btn} disabled={disabled || value <= 1} onClick={() => onChange(down)}>
        −
      </button>
      <span className="min-w-6 text-center font-mono font-semibold text-ink" aria-live="polite">
        {formatQuantity(value)}
      </span>
      <button type="button" aria-label="More servings" className={btn} disabled={disabled || value >= max} onClick={() => onChange(up)}>
        +
      </button>
    </div>
  );
}
