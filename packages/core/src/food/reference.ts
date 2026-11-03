import type { FoodInput, Measure, Nutrients, Portion, StapleDetail } from '@cycling-coach/shared';
import { canonicalUnit, isVolumeUnit, roundTo, unitKey } from './units';

/**
 * Staples from the Canadian Nutrient File and USDA FoodData Central (DECISIONS #33).
 * Both give nutrients per 100 g plus household portions as "label → grams" ("1 large egg" =
 * 52.61 g, "250 ml slices" = 158.5 g). Here those become a food whose reference serving is 100 g,
 * with one measure per portion.
 */

const FRACTION: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

function parseQuantity(s: string): number | null {
  const t = s.trim();
  if (FRACTION[t] != null) return FRACTION[t];
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A source portion read as a quantity and a unit: "1 large egg" → 1 × "large egg". */
export interface ParsedPortion extends Portion {
  /** True for a plain weight ("50 g") — redundant next to the 100 g reference. */
  isMass: boolean;
}

/**
 * "1 large egg" → 1 "large egg"; "125 ml" → 125 ml; "250 ml slices" → 1 "cup slices" (a volume
 * with a qualifier has its own density, so it becomes its own unit); "1 medium (18cm to 20cm long)"
 * → 1 "medium"; "50 g" → mass. Null when there's no leading quantity.
 */
export function parsePortionLabel(label: string): ParsedPortion | null {
  const m = /^((?:\d+\s+)?\d+(?:[./]\d+)?|[½¼¾⅓⅔])\s*(.*)$/.exec(label.trim());
  if (!m) return null;
  const quantity = parseQuantity(m[1]!);
  if (quantity == null) return null;
  const rest = m[2]!.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[,;]+$/, '').trim().toLowerCase();
  if (!rest) return null;
  const unitMatch = /^(ml|l|g|kg|oz|cups?|tbsp|tsp|fl oz)\b[,\s]*(.*)$/.exec(rest);
  if (unitMatch) {
    const unit = canonicalUnit(unitMatch[1]!);
    const qualifier = unitMatch[2]!.trim();
    if (unit === 'g' || unit === 'kg' || unit === 'oz') return { quantity, unit, isMass: !qualifier };
    if (!qualifier) return { quantity, unit, isMass: false };
    // "250 ml mashed" → cups of mashed: its own unit, measured in Canadian metric cups.
    const ml = isVolumeUnit(unit) ? quantity * { ml: 1, l: 1000, cup: 250, tbsp: 15, tsp: 5, fl_oz: 29.5735 }[unit as 'ml'] : quantity * 250;
    return { quantity: roundTo(ml / 250, 4), unit: `cup ${qualifier}`, isMass: false };
  }
  return { quantity, unit: canonicalUnit(rest), isMass: false };
}

/** The best everyday default among the portions: a "medium"/"large" piece, then any single piece, else 100 g. */
export function defaultPortionIndex(portions: readonly { label: string }[]): number {
  const parsed = portions.map((p) => parsePortionLabel(p.label));
  const piece = (pred: (u: string) => boolean) =>
    parsed.findIndex((p) => p && !p.isMass && p.quantity === 1 && !isVolumeUnit(unitKey(p.unit)) && !p.unit.startsWith('cup') && pred(p.unit));
  for (const pred of [(u: string) => /medium|large egg|^large$/.test(u), () => true]) {
    const i = piece(pred);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * A food ready to save from a staple: reference serving 100 g, a measure per portion (first one
 * wins per unit), and the chosen portion as the default (`defaultIndex` −1 = 100 g).
 */
export function foodFromStaple(staple: StapleDetail, opts: { name: string; defaultIndex: number }): FoodInput {
  const measures: Measure[] = [{ unit: 'g', amount: 100 }];
  let defaultPortion: Portion = { quantity: 100, unit: 'g' };
  staple.portions.forEach((p, i) => {
    const parsed = parsePortionLabel(p.label);
    if (!parsed || parsed.isMass || !(p.grams > 0)) return;
    // How many of this unit make 100 g.
    const amount = roundTo((parsed.quantity * 100) / p.grams, 4);
    const key = unitKey(parsed.unit);
    if (!measures.some((m) => unitKey(m.unit) === key)) measures.push({ unit: parsed.unit, amount });
    if (i === opts.defaultIndex) {
      const one = isVolumeUnit(key) ? parsed.quantity : 1;
      defaultPortion = { quantity: key === 'ml' ? parsed.quantity : one, unit: parsed.unit };
    }
  });
  return {
    name: opts.name.trim() || staple.name,
    aliases: [],
    barcodes: [],
    source: staple.source,
    sourceRef: staple.ref,
    servingLabel: '100 g',
    measures,
    defaultPortion,
    nutrients: staple.per100g,
    images: [],
  };
}

/** kcal for a portion of a staple, for the radio rows ("1 large egg · 75 kcal"). */
export const stapleKcal = (per100g: Nutrients, grams: number) => Math.round((per100g.kcal * grams) / 100);
