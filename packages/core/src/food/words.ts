import type { FoodLibrary, FoodParseResult, IsoDate, PhraseParse, PortionHint, WordsItem, WordsRef } from '@cycling-coach/shared';
import { addDays } from '../dates';
import { foodAsLoggable, recipeAsLoggable, startingPortion, usageKey, type Loggable } from './portions';
import { amountPerServing, canonicalUnit, formatPortion, isMassUnit, isVolumeUnit, unitKey, unitsFor } from './units';

/**
 * "Log with words" (DECISIONS #34). The small model only sees the user's own catalog
 * with short ids and answers with those ids; everything after that is deterministic and here:
 * ids are checked, missing amounts become their usual portion, units are validated. Nothing the
 * model says can log a food that isn't theirs, and nothing is logged until they confirm.
 */

export interface CatalogLine {
  id: string;
  name: string;
  aliases: string[];
  units: string[];
  usual?: string | undefined;
}

export const portionHintText = (h: PortionHint) => (h.of > 1 ? `Usually ${formatPortion(h.quantity, h.unit)} (${h.times} of ${h.of})` : `Last time ${formatPortion(h.quantity, h.unit)}`);

/** Active foods, recipes and meals as catalog lines with short ids (f1…, r1…, m1…). */
export function buildCatalog(lib: FoodLibrary): { lines: CatalogLine[]; refs: Map<string, WordsRef> } {
  const lines: CatalogLine[] = [];
  const refs = new Map<string, WordsRef>();
  const usual = (kind: 'food' | 'recipe' | 'meal', id: string) => {
    const u = lib.usage[usageKey(kind, id)]?.usual;
    return u ? formatPortion(u.quantity, u.unit) : undefined;
  };
  lib.foods
    .filter((f) => !f.archived)
    .forEach((f, i) => {
      const id = `f${i + 1}`;
      refs.set(id, { kind: 'food', id: f.id, name: f.name });
      lines.push({ id, name: f.brand ? `${f.name} (${f.brand})` : f.name, aliases: f.aliases, units: unitsFor(f).slice(0, 8), usual: usual('food', f.id) ?? formatPortion(f.defaultPortion.quantity, f.defaultPortion.unit) });
    });
  lib.recipes
    .filter((r) => !r.archived)
    .forEach((r, i) => {
      const id = `r${i + 1}`;
      refs.set(id, { kind: 'recipe', id: r.id, name: r.name });
      lines.push({ id, name: `${r.name} (recipe)`, aliases: r.aliases, units: unitsFor(recipeAsLoggable(r)), usual: usual('recipe', r.id) ?? '1 serving' });
    });
  lib.meals
    .filter((m) => !m.archived)
    .forEach((m, i) => {
      const id = `m${i + 1}`;
      refs.set(id, { kind: 'meal', id: m.id, name: m.name });
      lines.push({ id, name: `${m.name} (saved meal${m.slot ? `, usually ${m.slot}` : ''})`, aliases: m.aliases, units: ['serving'] });
    });
  return { lines, refs };
}

function loggableFor(lib: FoodLibrary, ref: WordsRef): Loggable | undefined {
  if (ref.kind === 'food') {
    const f = lib.foods.find((x) => x.id === ref.id);
    return f ? foodAsLoggable(f) : undefined;
  }
  if (ref.kind === 'recipe') {
    const r = lib.recipes.find((x) => x.id === ref.id);
    return r ? recipeAsLoggable(r) : undefined;
  }
  return undefined;
}

/** A unit that counts pieces: the usual one if it does, else the food's first label unit, else serving. */
function countUnit(item: Loggable, usualUnit: string): string {
  const isMeasured = (u: string) => isMassUnit(unitKey(u)) || isVolumeUnit(unitKey(u));
  if (!isMeasured(usualUnit)) return usualUnit;
  return item.measures.map((m) => m.unit).find((u) => !isMeasured(u) && u !== 'serving') ?? 'serving';
}

/** The model's answer → confirm-screen items, with every ref, unit and amount checked. */
export function resolveWords(
  parse: PhraseParse,
  refs: ReadonlyMap<string, WordsRef>,
  lib: FoodLibrary,
  opts: { viewedDate: IsoDate; slot: string },
): FoodParseResult {
  const slotNames = lib.settings.slots.map((s) => s.name);
  const slot = slotNames.find((s) => s.toLowerCase() === parse.slot?.toLowerCase()) ?? opts.slot;
  const offset = Math.max(-7, Math.min(1, Math.round(parse.dayOffset)));
  const time = parse.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(parse.time) ? parse.time : undefined;

  const items: WordsItem[] = parse.items.map((p) => {
    const match = (p.ref && refs.get(p.ref)) || null;
    const alternatives = p.alternatives
      .map((a) => refs.get(a))
      .filter((r): r is WordsRef => !!r && r.id !== match?.id)
      .slice(0, 3);
    const said = p.quantity != null && p.quantity > 0 ? p.quantity : null;
    if (!match) return { heard: p.heard, match: null, alternatives, quantity: said ?? 1, unit: 'serving', why: '' };
    if (match.kind === 'meal') {
      const q = said ?? 1;
      return { heard: p.heard, match, alternatives, quantity: q, unit: 'serving', why: q === 1 ? 'The whole saved meal' : `${q}× the saved meal` };
    }
    const item = loggableFor(lib, match);
    if (!item) return { heard: p.heard, match: null, alternatives, quantity: 1, unit: 'serving', why: '' };
    const start = startingPortion(item, lib.usage[usageKey(match.kind, match.id)], slot);
    const unitSaid = p.unit ? canonicalUnit(p.unit) : null;
    const validSaid = unitSaid && amountPerServing(item, unitSaid) != null ? unitSaid : null;
    if (said != null) {
      const unit = validSaid ?? countUnit(item, start.unit);
      return { heard: p.heard, match, alternatives, quantity: said, unit, why: `You said ${formatPortion(said, unit)}` };
    }
    if (validSaid && validSaid !== canonicalUnit(start.unit)) {
      return { heard: p.heard, match, alternatives, quantity: 1, unit: validSaid, why: `You said a ${validSaid}` };
    }
    return { heard: p.heard, match, alternatives, quantity: start.quantity, unit: start.unit, why: start.hint ? `Your usual: ${portionHintText(start.hint).replace(/^Usually /, '')}` : 'Default portion' };
  });

  return { date: addDays(opts.viewedDate, offset), slot, ...(time ? { time } : {}), items };
}
