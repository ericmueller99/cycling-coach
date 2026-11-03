import { MACRO_COLOR } from '../lib/food';

/** P/C/F share of energy as one bar (fractions from `core.macroSplit`). */
export function MacroBar({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  return (
    <div className="flex h-2 overflow-hidden rounded-[4px] bg-track" aria-hidden="true">
      <span style={{ width: `${protein * 100}%`, background: MACRO_COLOR.protein }} />
      <span style={{ width: `${carbs * 100}%`, background: MACRO_COLOR.carbs }} />
      <span style={{ width: `${fat * 100}%`, background: MACRO_COLOR.fat }} />
    </div>
  );
}
