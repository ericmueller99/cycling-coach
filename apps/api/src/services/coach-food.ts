import type { CallUsage, FoodAi, IngredientMatchResult, NewMealIdeas, NewRecipeDraft } from '@cycling-coach/coach';
import {
  buildCatalog,
  canonicalUnit,
  computePortion,
  defaultPortionIndex,
  draftToRecipeInput,
  foodFromStaple,
  perServingOf,
  priceLines,
  rankByText,
  scaleLines,
  stapleCovers,
  stapleWords,
} from '@cycling-coach/core';
import {
  addRecipeDraftLog,
  addThreadTag,
  getFood,
  getFoodsByIds,
  getMealIdeas,
  getRecipeDraft,
  idOf,
  insertMealIdeas,
  insertRecipeDraft,
  markIdeaPicked,
  recordAiCall,
  setMealIdeas,
  setRecipeDraftSaved,
  toMealIdeas,
  updateRecipeDraft,
  type Collections,
  type RecipeDraftDoc,
} from '@cycling-coach/db';
import type {
  Food,
  FoodLibrary,
  IngredientLine,
  IngredientMatch,
  IngredientSuggestion,
  MealIdea,
  MealIdeaFix,
  MealIdeas,
  RecipeDraft,
  RecipeDraftLogInput,
  RecipeDraftPatch,
  StapleDetail,
  StapleSearchPayload,
  StapleSource,
} from '@cycling-coach/shared';
import type { ObjectId } from 'mongodb';
import type { ServiceFailure as Failure } from '../app';
import type { FoodService } from './food';

type Line = IngredientLine & { match: IngredientMatch | null };

/** What matching needs — injected so the merge rules are testable without a database or a model. */
export interface MatchDeps {
  library: FoodLibrary;
  /** Null when the food model isn't configured: staples only. */
  matchWithAi: ((input: Parameters<FoodAi['matchIngredients']>[0]) => Promise<{ ok: true; value: IngredientMatchResult } | { ok: false }>) | null;
  searchStaples(q: string, source: StapleSource): Promise<StapleSearchPayload>;
  stapleDetail(source: StapleSource, ref: string): Promise<StapleDetail | Failure>;
}

/**
 * The coach's ingredient lines → matches. The small model picks from the user's foods
 * by short id; ids are checked here. A miss tries the top Canadian staple, used only when its name
 * covers every word of the ingredient (same rule as Log with AI, DECISIONS #40). "To taste" lines
 * aren't matched. Nothing is saved.
 */
export async function matchLines(deps: MatchDeps, items: readonly IngredientLine[]): Promise<Line[]> {
  const { lines, refs } = buildCatalog(deps.library);
  const foodsById = new Map(deps.library.foods.map((f) => [f.id, f]));
  // A restaurant estimate is a whole meal and a guess: a recipe would lose the Estimate tag.
  const foodLines = lines.filter((l) => {
    const ref = refs.get(l.id);
    return ref?.kind === 'food' && foodsById.get(ref.id)?.source !== 'estimate';
  });
  const wanted = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.toTaste);

  const byIndex = new Map<number, IngredientMatchResult['items'][number]>();
  if (deps.matchWithAi && foodLines.length && wanted.length) {
    const res = await deps.matchWithAi({ catalog: foodLines, items: wanted.map(({ it }) => ({ name: it.name, quantity: it.quantity, unit: it.unit })) });
    if (res.ok) res.value.items.forEach((m) => { const w = wanted[m.index]; if (w) byIndex.set(w.i, m); });
  }

  const details = new Map<string, Promise<StapleDetail | null>>();
  const stapleFor = async (name: string): Promise<IngredientMatch | null> => {
    const q = stapleWords(name).join(' ') || name;
    if (q.length < 2) return null;
    const top = (await deps.searchStaples(q.slice(0, 80), 'cnf')).results[0];
    if (!top || !stapleCovers(name, top.name)) return null;
    const key = `${top.source}:${top.ref}`;
    if (!details.has(key)) details.set(key, deps.stapleDetail(top.source, top.ref).then((d) => ('error' in d ? null : d)));
    const detail = await details.get(key)!;
    return detail ? { kind: 'staple', source: detail.source, ref: detail.ref, name: detail.name, detail } : null;
  };

  return Promise.all(
    items.map(async (it, i): Promise<Line> => {
      if (it.toTaste) return { ...it, match: null };
      const m = byIndex.get(i);
      const ref = m?.ref ? refs.get(m.ref) : undefined;
      const food = ref?.kind === 'food' ? foodsById.get(ref.id) : undefined;
      if (food) {
        let { quantity, unit } = it;
        // The model converts only when the coach's unit can't be measured for this food.
        if (!computePortion(food, quantity, canonicalUnit(unit)) && m?.quantity && m.unit && computePortion(food, m.quantity, canonicalUnit(m.unit))) {
          quantity = m.quantity;
          unit = m.unit;
        }
        return { ...it, quantity, unit, match: { kind: 'food', foodId: food.id, name: food.name, source: food.source } };
      }
      return { ...it, match: await stapleFor(it.name).catch(() => null) };
    }),
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim();

const MAX_SUGGESTIONS = 3;

/**
 * Matches to offer for an unmatched ingredient in the Details pane: their foods first, then
 * CNF staples. Offers, not auto-matches, so no `stapleCovers` gate — but the whole name is tried
 * before its single words ("Baby potatoes" → "potatoes"), longest word first.
 */
export async function suggestMatches(deps: Pick<MatchDeps, 'library' | 'searchStaples'>, name: string): Promise<IngredientSuggestion[]> {
  const words = stapleWords(name);
  const queries = [...new Set([words.join(' ') || name, ...[...words].sort((a, b) => b.length - a.length)])].filter((q) => q.length >= 2);
  const out: IngredientSuggestion[] = [];
  const seen = new Set<string>();
  const add = (key: string, s: IngredientSuggestion) => {
    if (out.length >= MAX_SUGGESTIONS || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  const foods = deps.library.foods.filter((f) => !f.archived && f.source !== 'estimate');
  for (const q of queries) for (const f of rankByText(foods, q, MAX_SUGGESTIONS)) add(`food:${f.id}`, { kind: 'food', foodId: f.id, name: f.name, source: f.source });
  for (const q of queries.slice(0, 3)) {
    if (out.length >= MAX_SUGGESTIONS) break;
    // A staple already saved as one of their foods is offered as that food.
    const saved = new Set(foods.flatMap((f) => (f.sourceRef ? [`${f.source}:${f.sourceRef}`] : [])));
    const hits = await deps.searchStaples(q.slice(0, 80), 'cnf').catch(() => ({ results: [] as StapleSearchPayload['results'] }));
    // The staple search matches prefixes ("salmon" → "Salmonberry"); whole words first.
    const whole = (n: string) => stapleWords(n).filter((w) => words.some((x) => x === w || x === `${w}s` || `${x}s` === w)).length;
    const ranked = hits.results.map((h, i) => ({ h, i, w: whole(h.name) })).sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.h);
    for (const h of ranked) if (!saved.has(`${h.source}:${h.ref}`)) add(`staple:${h.source}:${h.ref}`, { kind: 'staple', source: h.source, ref: h.ref, name: h.name });
  }
  return out;
}

/** Re-price one idea's lines (after matching or a fix). */
export function priceIdea(idea: Omit<MealIdea, 'perServing' | 'unpriced'>, foods: ReadonlyMap<string, Food>): MealIdea {
  const priced = priceLines(idea.ingredients, foods);
  const counted = priced.ingredients.some((l) => l.kcal != null);
  return {
    ...idea,
    ingredients: priced.ingredients,
    perServing: counted ? perServingOf(priced.total, idea.servings) : null,
    unpriced: priced.ingredients.filter((l) => l.problem).map((l) => l.name),
  };
}

/**
 * Apply a picked match to the ingredient at `at` and every other unmatched line of the same name
 * across the ideas, then re-price the ideas it touched. Null when `at` doesn't point at an
 * unmatched line. No AI.
 */
export function applyIdeaFix(ideas: readonly MealIdea[], at: { idea: number; ingredient: number }, match: IngredientMatch, foods: ReadonlyMap<string, Food>): MealIdea[] | null {
  const target = ideas[at.idea]?.ingredients[at.ingredient];
  if (!target || target.toTaste || target.problem !== 'unmatched') return null;
  const key = norm(target.name);
  return ideas.map((idea) => {
    if (!idea.ingredients.some((l) => !l.toTaste && l.problem === 'unmatched' && norm(l.name) === key)) return idea;
    const ingredients = idea.ingredients.map((l) => {
      if (l.toTaste || l.problem !== 'unmatched' || norm(l.name) !== key) return l;
      const { suggestions: _s, ...rest } = l;
      return { ...rest, match };
    });
    return priceIdea({ ...idea, ingredients }, foods);
  });
}

/**
 * Meal ideas and recipes built in Coach chat (DECISIONS #41). Drafts: the only
 * writes to the user's foods, recipes and log happen in `save` / `log`, i.e. on their button press.
 */
export class CoachFoodService {
  /** One save per draft at a time, so a double click can't make two recipes. */
  private saving = new Map<string, Promise<RecipeDraft | Failure>>();

  constructor(
    private readonly c: Collections,
    private readonly food: FoodService,
    private readonly staples: Pick<MatchDeps, 'searchStaples' | 'stapleDetail'>,
    private readonly ai: FoodAi | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async match(userId: string, threadId: ObjectId, items: readonly IngredientLine[]): Promise<Line[]> {
    return matchLines(
      {
        library: await this.food.library(userId),
        matchWithAi: this.ai
          ? async (input) => {
              const res = await this.ai!.matchIngredients(input);
              await this.record(userId, threadId, res.usage);
              return res.ok ? { ok: true, value: res.value } : { ok: false };
            }
          : null,
        searchStaples: (q, s) => this.staples.searchStaples(q, s),
        stapleDetail: (s, r) => this.staples.stapleDetail(s, r),
      },
      items,
    );
  }

  private async record(userId: string, threadId: ObjectId, u: CallUsage | undefined) {
    if (!u) return;
    await recordAiCall(this.c, {
      userId,
      threadId,
      purpose: 'food_match',
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      costUsd: u.costUsd,
      ...(u.stopReason ? { stopReason: u.stopReason } : {}),
      createdAt: this.now(),
    });
  }

  private async foodsFor(userId: string, lines: readonly Line[]): Promise<Map<string, Food>> {
    const ids = [...new Set(lines.flatMap((l) => (l.match?.kind === 'food' ? [l.match.foodId] : [])))];
    return new Map((await getFoodsByIds(this.c, userId, ids)).map((f) => [f.id, f]));
  }

  // ── Tools (called by the coach through its port) ──────────────────────

  /** All ideas' ingredients in one match call; each idea priced per serving. */
  async createMealIdeas(userId: string, threadId: ObjectId, input: NewMealIdeas): Promise<MealIdeas> {
    const flat = input.ideas.flatMap((idea) => idea.ingredients);
    const matched = await this.match(userId, threadId, flat);
    const foods = await this.foodsFor(userId, matched);
    const library = await this.food.library(userId);
    // Offers for each unmatched name, looked up once (the same miss often recurs across ideas).
    const offers = new Map<string, Promise<IngredientSuggestion[]>>();
    const offersFor = (name: string) => {
      const k = norm(name);
      if (!offers.has(k)) offers.set(k, suggestMatches({ library, searchStaples: (q, src) => this.staples.searchStaples(q, src) }, name).catch(() => []));
      return offers.get(k)!;
    };
    let at = 0;
    const ideas = await Promise.all(
      input.ideas.map(async (idea): Promise<MealIdea> => {
        const lines = matched.slice(at, (at += idea.ingredients.length));
        const priced = priceIdea(
          {
            tag: idea.tag,
            name: idea.name,
            description: idea.description,
            minutes: idea.minutes,
            servings: idea.servings,
            ingredients: lines,
            ...(idea.difficulty ? { difficulty: idea.difficulty } : {}),
            ...(idea.equipment?.length ? { equipment: idea.equipment } : {}),
            ...(idea.leftovers ? { leftovers: idea.leftovers } : {}),
            ...(idea.why ? { why: idea.why } : {}),
            ...(idea.steps?.length ? { steps: idea.steps } : {}),
          },
          foods,
        );
        const ingredients = await Promise.all(
          priced.ingredients.map(async (l) => {
            if (l.problem !== 'unmatched') return l;
            const suggestions = await offersFor(l.name);
            return suggestions.length ? { ...l, suggestions } : l;
          }),
        );
        return { ...priced, ingredients };
      }),
    );
    const doc = await insertMealIdeas(this.c, {
      userId,
      threadId,
      toolUseId: input.toolUseId,
      slot: input.slot,
      date: input.date,
      ideas,
      followUps: input.followUps,
      picked: [],
      ...(input.kcalRange && input.kcalRange.max >= input.kcalRange.min ? { kcalRange: input.kcalRange } : {}),
      createdAt: this.now(),
    });
    await addThreadTag(this.c, threadId, 'food');
    return toMealIdeas(doc);
  }

  /** Lines already matched on the picked idea keep their match; only new ones are sent to the model. */
  async createRecipeDraft(userId: string, threadId: ObjectId, input: NewRecipeDraft): Promise<RecipeDraft> {
    const ideasDoc = input.ideasId ? await getMealIdeas(this.c, userId, input.ideasId) : null;
    const idea = ideasDoc && input.ideaIndex != null ? ideasDoc.ideas[input.ideaIndex] : undefined;
    const known = new Map((idea?.ingredients ?? []).filter((l) => l.match).map((l) => [norm(l.name), l]));
    const fresh = input.ingredients.filter((l) => !l.toTaste && !known.has(norm(l.name)));
    const freshMatched = fresh.length ? await this.match(userId, threadId, fresh) : [];
    const ingredients = input.ingredients.map((l): Line => {
      if (l.toTaste) return { ...l, match: null };
      const prev = known.get(norm(l.name));
      if (prev) return { ...l, match: prev.match };
      return freshMatched[fresh.indexOf(l)] ?? { ...l, match: null };
    });
    const now = this.now();
    const doc = await insertRecipeDraft(this.c, {
      userId,
      threadId,
      toolUseId: input.toolUseId,
      ...(ideasDoc && input.ideaIndex != null && idea ? { ideasId: input.ideasId!, ideaIndex: input.ideaIndex } : {}),
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      servings: input.servings,
      ...(input.minutes ? { minutes: input.minutes } : {}),
      ingredients,
      steps: input.steps,
      logged: [],
      createdAt: now,
      updatedAt: now,
    });
    if (ideasDoc && input.ideaIndex != null && idea) await markIdeaPicked(this.c, userId, input.ideasId!, input.ideaIndex);
    await addThreadTag(this.c, threadId, 'food');
    return this.view(userId, doc);
  }

  // ── The user's side (the recipe pane) ────────────────────────────────

  async view(userId: string, doc: RecipeDraftDoc): Promise<RecipeDraft> {
    const priced = priceLines(doc.ingredients, await this.foodsFor(userId, doc.ingredients));
    return {
      id: idOf(doc),
      threadId: doc.threadId.toHexString(),
      ...(doc.ideasId ? { ideasId: doc.ideasId, ideaIndex: doc.ideaIndex } : {}),
      name: doc.name,
      ...(doc.description ? { description: doc.description } : {}),
      servings: doc.servings,
      ...(doc.minutes ? { minutes: doc.minutes } : {}),
      ingredients: priced.ingredients,
      steps: doc.steps,
      ...(doc.recipeId ? { recipeId: doc.recipeId } : {}),
      logged: doc.logged,
      totals: { total: priced.total, perServing: perServingOf(priced.total, doc.servings), unresolved: priced.unresolved, staples: priced.staples },
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async get(userId: string, id: string): Promise<RecipeDraft | null> {
    const doc = await getRecipeDraft(this.c, userId, id);
    return doc ? this.view(userId, doc) : null;
  }

  async ideas(userId: string, id: string): Promise<MealIdeas | null> {
    const doc = await getMealIdeas(this.c, userId, id);
    return doc ? toMealIdeas(doc) : null;
  }

  /**
   * The user picks a match for an unmatched ingredient in the Details pane. A staple becomes
   * one of their foods (their click, rule 1a). The fix lives on the `meal_ideas` doc — the transcript
   * only holds its id (rule 2) — and carries into the recipe, which reuses matched lines.
   */
  async fixIdeaIngredient(userId: string, id: string, fix: MealIdeaFix): Promise<MealIdeas | Failure> {
    const doc = await getMealIdeas(this.c, userId, id);
    if (!doc?._id) return { error: 'Meal ideas not found.', status: 404 };
    const target = doc.ideas[fix.idea]?.ingredients[fix.ingredient];
    if (!target || target.toTaste || target.problem !== 'unmatched') return { error: 'That ingredient is already matched.', status: 400 };
    let food: Food | null;
    if (fix.foodId) {
      food = await getFood(this.c, userId, fix.foodId);
      if (!food) return { error: 'Food not found.', status: 404 };
    } else {
      const detail = await this.staples.stapleDetail(fix.staple!.source, fix.staple!.ref);
      if ('error' in detail) return detail;
      const saved = await this.foodForStaple(userId, detail, await this.food.library(userId));
      if ('error' in saved) return saved;
      food = saved;
    }
    const match: IngredientMatch = { kind: 'food', foodId: food.id, name: food.name, source: food.source };
    const lines = doc.ideas.flatMap((i) => i.ingredients);
    const foods = await this.foodsFor(userId, [...lines, { ...target, match }]);
    const ideas = applyIdeaFix(doc.ideas, fix, match, foods);
    if (!ideas) return { error: 'That ingredient is already matched.', status: 400 };
    const updated = await setMealIdeas(this.c, userId, doc._id, ideas);
    return updated ? toMealIdeas(updated) : { error: 'Meal ideas not found.', status: 404 };
  }

  /** Their food for a staple: one saved earlier from the same staple, else a new one. */
  private async foodForStaple(userId: string, detail: StapleDetail, lib: FoodLibrary, name = detail.name): Promise<Food | Failure> {
    const existing = lib.foods.find((f) => !f.archived && f.source === detail.source && f.sourceRef === detail.ref);
    if (existing) return existing;
    return this.food.createFood(userId, foodFromStaple(detail, { name, defaultIndex: defaultPortionIndex(detail.portions) }));
  }

  async patch(userId: string, id: string, patch: RecipeDraftPatch): Promise<RecipeDraft | Failure> {
    const doc = await getRecipeDraft(this.c, userId, id);
    if (!doc?._id) return { error: 'Recipe not found.', status: 404 };
    if (doc.recipeId) return { error: 'This recipe is saved — edit it in Library › Recipes.', status: 409 };
    // "Making it for 3": every amount scales with the servings, so per-serving numbers hold (DECISIONS #47).
    const ingredients = patch.servings && patch.servings !== doc.servings ? scaleLines(doc.ingredients, doc.servings, patch.servings) : [...doc.ingredients];
    const p = patch.ingredient;
    if (p) {
      const line = ingredients[p.index];
      if (!line) return { error: 'No such ingredient.', status: 400 };
      if (p.remove) {
        if (ingredients.length === 1) return { error: 'A recipe needs at least one ingredient.', status: 400 };
        ingredients.splice(p.index, 1);
      } else {
        let match = line.match;
        if (p.foodId) {
          const food = await getFood(this.c, userId, p.foodId);
          if (!food) return { error: 'Food not found.', status: 404 };
          match = { kind: 'food', foodId: food.id, name: food.name, source: food.source };
        } else if (p.staple) {
          const detail = await this.staples.stapleDetail(p.staple.source, p.staple.ref);
          if ('error' in detail) return detail;
          match = { kind: 'staple', source: detail.source, ref: detail.ref, name: detail.name, detail };
        }
        ingredients[p.index] = {
          ...line,
          match,
          ...(p.quantity != null ? { quantity: p.quantity } : {}),
          ...(p.unit ? { unit: p.unit } : {}),
          ...(p.toTaste != null ? { toTaste: p.toTaste } : {}),
        };
      }
    }
    const updated = await updateRecipeDraft(this.c, userId, doc._id, { ingredients, ...(patch.servings ? { servings: patch.servings } : {}) }, this.now());
    if (!updated) return { error: 'This recipe is saved — edit it in Library › Recipes.', status: 409 };
    return this.view(userId, updated);
  }

  /**
   * Save as a Library recipe (rule 1a: this is the user's click). Staples in use become their foods —
   * reusing one already saved from the same staple. Idempotent: a saved draft returns as is.
   */
  save(userId: string, id: string): Promise<RecipeDraft | Failure> {
    const key = `${userId}:${id}`;
    const running = this.saving.get(key);
    if (running) return running;
    const p = this.doSave(userId, id).finally(() => this.saving.delete(key));
    this.saving.set(key, p);
    return p;
  }

  private async doSave(userId: string, id: string): Promise<RecipeDraft | Failure> {
    const doc = await getRecipeDraft(this.c, userId, id);
    if (!doc?._id) return { error: 'Recipe not found.', status: 404 };
    if (doc.recipeId) return this.view(userId, doc);
    const priced = priceLines(doc.ingredients, await this.foodsFor(userId, doc.ingredients));
    if (priced.unresolved) {
      const names = priced.ingredients.filter((l) => l.problem).map((l) => l.name);
      return { error: `Pick a food for ${names.join(', ')} or remove ${names.length === 1 ? 'it' : 'them'} first.`, status: 409 };
    }

    // Staples → their foods (one per staple), reusing a food saved earlier from the same staple.
    const lib = await this.food.library(userId);
    const stapleFood = new Map<string, string>();
    for (const line of doc.ingredients) {
      const m = line.match;
      if (line.toTaste || m?.kind !== 'staple') continue;
      const key = `${m.source}:${m.ref}`;
      if (stapleFood.has(key)) continue;
      const f = await this.foodForStaple(userId, m.detail, lib, m.name);
      if ('error' in f) return f;
      stapleFood.set(key, f.id);
    }
    const foodIdFor = (m: IngredientMatch) => (m.kind === 'food' ? m.foodId : stapleFood.get(`${m.source}:${m.ref}`)!);
    const recipe = await this.food.createRecipe(userId, draftToRecipeInput(doc, foodIdFor));

    // The draft now points at their foods, like the recipe does.
    const saved = await this.food.library(userId);
    const byId = new Map(saved.foods.map((f) => [f.id, f]));
    const ingredients = doc.ingredients.map((l): Line => {
      if (l.match?.kind !== 'staple') return l;
      const f = byId.get(foodIdFor(l.match));
      return f ? { ...l, match: { kind: 'food', foodId: f.id, name: f.name, source: f.source } } : l;
    });
    const won = await setRecipeDraftSaved(this.c, userId, doc._id, recipe.id, ingredients, this.now());
    if (!won) await this.food.archiveRecipe(userId, recipe.id);
    const after = await getRecipeDraft(this.c, userId, id);
    return this.view(userId, after!);
  }

  /** Log servings of it (saving it first if needed) as a normal recipe entry. */
  async log(userId: string, id: string, input: RecipeDraftLogInput): Promise<RecipeDraft | Failure> {
    const saved = await this.save(userId, id);
    if ('error' in saved) return saved;
    const entries = await this.food.log(userId, [
      { date: input.date, slot: input.slot, ...(input.time ? { time: input.time } : {}), kind: 'recipe', refId: saved.recipeId!, quantity: input.quantity, unit: 'serving', via: 'coach' },
    ]);
    if ('error' in entries) return entries;
    const entry = entries[0]!;
    const doc = await addRecipeDraftLog(
      this.c,
      userId,
      (await getRecipeDraft(this.c, userId, id))!._id!,
      { date: entry.date, slot: entry.slot, quantity: input.quantity, kcal: Math.round(entry.nutrients.kcal), entryId: entry.id, at: this.now().toISOString() },
      this.now(),
    );
    return this.view(userId, doc!);
  }
}

