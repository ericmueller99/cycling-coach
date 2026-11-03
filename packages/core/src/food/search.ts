import type { FoodUsage, IsoDate } from '@cycling-coach/shared';
import { daysBetween } from '../dates';

/** Lower-case, strip accents and punctuation: "Café au lait, 2%" → "cafe au lait 2". */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokens = (s: string) => normalizeText(s).split(' ').filter(Boolean);

/** Edit distance ≤ 1 (one typo), for tokens long enough that it means something. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
      i += 2; // transposition: "bagle" ↔ "bagel"
      j += 2;
    } else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatch(q: string, word: string): number {
  if (word === q) return 3;
  // Numbers match whole numbers only: "2" (as in 2% milk) isn't the start of "250 ml".
  if (/^\d+$/.test(q)) return 0;
  if (word.startsWith(q)) return 2;
  // One typo, against whole words only ("bagle" → bagel); prefixes with typos match too much ("oats" → "outside").
  if (q.length >= 4 && word.length >= 4 && withinOneEdit(q, word)) return 1;
  return 0;
}

/**
 * How well a query matches one text: every query token must match some word (exact > prefix >
 * one typo). 0 = no match. Whole-phrase and leading matches score higher.
 */
export function textScore(query: string, text: string): number {
  const q = tokens(query);
  if (!q.length) return 0;
  const words = tokens(text);
  let score = 0;
  for (const t of q) {
    const best = Math.max(0, ...words.map((w) => tokenMatch(t, w)));
    if (!best) return 0;
    score += best * 10;
  }
  const nq = normalizeText(query);
  const nt = normalizeText(text);
  if (nt === nq) score += 60;
  else if (nt.startsWith(nq)) score += 30;
  // Shorter names are closer matches ("Egg" before "Egg noodles, enriched, cooked").
  score += Math.max(0, 10 - (words.length - q.length) * 2);
  return score;
}

export interface Searchable {
  name: string;
  brand?: string | undefined;
  aliases?: readonly string[] | undefined;
}

/** Best match over name, aliases and brand + name. Aliases score a little under the name. */
export function searchableScore(query: string, item: Searchable): number {
  const scores = [
    textScore(query, item.name),
    ...(item.aliases ?? []).map((a) => textScore(query, a) * 0.9),
    item.brand ? textScore(query, `${item.brand} ${item.name}`) * 0.95 : 0,
  ];
  return Math.max(...scores);
}

/**
 * Rank the user's own foods, recipes and meals: text match first, then how often and how recently they
 * logs each. An empty query ranks by use alone (the "Recent" list).
 */
export function rankByUse<T extends Searchable>(
  items: readonly T[],
  query: string,
  usageOf: (item: T) => FoodUsage | undefined,
  today: IsoDate,
): T[] {
  const q = query.trim();
  const scored = items
    .map((item) => {
      const usage = usageOf(item);
      const text = q ? searchableScore(q, item) : 0;
      if (q && !text) return null;
      const freq = usage ? Math.log2(1 + usage.count) * 6 : 0;
      const age = usage ? Math.max(0, daysBetween(usage.lastDate, today)) : 365;
      const recency = Math.max(0, 30 - age) / 2;
      return { item, score: text + freq + recency };
    })
    .filter((x): x is { item: T; score: number } => x != null);
  if (!q) return scored.filter((s) => usageOf(s.item)).sort((a, b) => b.score - a.score).map((s) => s.item);
  return scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).map((s) => s.item);
}

/** Plain text ranking (staples): best matches first, at most `limit`. */
export function rankByText<T extends Searchable>(items: readonly T[], query: string, limit = 30): T[] {
  return items
    .map((item) => ({ item, score: searchableScore(query, item) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
    .slice(0, limit)
    .map((s) => s.item);
}

/** One reference food in the staples index (Canadian Nutrient File). */
export interface StapleIndexItem {
  code: string;
  name: string;
  alt?: string | undefined;
  group?: string | undefined;
  kcal: number;
  portionLabels: string[];
}

/** Groups that are rarely what "add a staple" means. */
const UNLIKELY_GROUPS = /fast foods|babyfoods|mixed dishes|restaurant/i;
/** CNF files some staples under a category first: "Grains, rice, white…", "Sweets, sugars, granulated". */
const CATEGORY_PREFIX = /^(grains|cereals?|sweets|snacks|spices|beverages|nuts|fats|oils|vegetable oil)\s*,\s*/i;
/** Prepared mixes and flavoured versions are rarely the staple meant. */
const NOT_PLAIN = ['mix', 'flavour', 'flavoured', 'flavored', 'seasonings'];

/** The name without a CNF category prefix: "Grains, rice, white" → "rice, white". */
const stapleName = (name: string) => name.replace(CATEGORY_PREFIX, '');

/**
 * Rank CNF staples. CNF names lead with the food ("Egg, chicken, whole, fresh or frozen, raw"), so
 * a query word that IS the lead noun scores high, raw foods edge out prepared ones, and fast food
 * or baby food sinks. Household portions count with the lead noun ("Egg 1 large egg" matches
 * "large egg"; "Bagel 1 large" doesn't). When too few names match every word, foods matching at
 * least half the words follow ("rolled oats" → oats).
 */
export function rankStaples<T extends StapleIndexItem>(items: readonly T[], query: string, limit = 30): T[] {
  const qTokens = tokens(query);
  if (!qTokens.length) return [];
  const bonus = (it: T) => {
    const plain = stapleName(it.name);
    const lead = normalizeText(plain.split(',')[0] ?? plain);
    const name = tokens(it.name);
    let b = 0;
    if (qTokens.includes(lead) || (qTokens.length > 1 && lead === qTokens.join(' '))) b += 15;
    else if (qTokens.some((t) => lead.startsWith(t))) b += 5;
    if (name.includes('raw')) b += 8;
    if (name.includes('whole')) b += 2;
    if (it.group && UNLIKELY_GROUPS.test(it.group)) b -= 12;
    if (NOT_PLAIN.some((w) => name.includes(w))) b -= 5;
    // Everyday foods carry many household portions (a chicken egg has 11, a quail egg 1).
    b += Math.min(6, it.portionLabels.length);
    return b;
  };
  const full: { it: T; score: number }[] = [];
  for (const it of items) {
    const plain = stapleName(it.name);
    const named = Math.max(
      searchableScore(query, { name: it.name, aliases: it.alt ? [it.alt] : [] }),
      plain !== it.name ? textScore(query, plain) : 0,
    );
    const lead = plain.split(',')[0] ?? plain;
    const portion = Math.max(0, ...it.portionLabels.map((l) => textScore(query, `${lead} ${l}`))) * 0.85;
    const score = Math.max(named, portion);
    if (score > 0) full.push({ it, score: score + bonus(it) });
  }
  const byScore = (a: { it: T; score: number }, b: { it: T; score: number }) =>
    b.score - a.score || a.it.name.length - b.it.name.length || a.it.name.localeCompare(b.it.name);
  const ranked = full.sort(byScore).map((x) => x.it);
  if (ranked.length >= 5 || qTokens.length < 2) return ranked.slice(0, limit);

  const seen = new Set(ranked);
  const partial = items
    .filter((it) => !seen.has(it))
    .map((it) => {
      const text = `${it.name} ${it.alt ?? ''}`;
      const hits = qTokens.filter((t) => textScore(t, text) > 0).length;
      return { it, ratio: hits / qTokens.length };
    })
    .filter((x) => x.ratio >= 0.5)
    .map((x) => ({ it: x.it, score: x.ratio * 20 + bonus(x.it) }))
    .sort(byScore)
    .map((x) => x.it);
  return [...ranked, ...partial].slice(0, limit);
}
