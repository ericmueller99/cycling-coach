import type { FoodSource } from '@cycling-coach/shared';
import { SOURCE_STYLE } from '../../lib/food';

/** The small coloured tag after a food's name: Label, Photo, CNF, USDA, OFF, Recipe, Meal, Manual. */
export function SourceTag({ source }: { source: FoodSource | 'recipe' | 'meal' }) {
  const s = SOURCE_STYLE[source];
  return (
    <span className="flex-none rounded-[5px] px-1.5 text-[10px] leading-[17px] font-bold" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}
