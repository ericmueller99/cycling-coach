import Anthropic from '@anthropic-ai/sdk';
import { nutritionReadingSchema, phraseParseSchema, type NutritionReading, type PhotoReadInput, type PhraseParse } from '@cycling-coach/shared';
import { z } from 'zod';
import type { CallUsage } from './engine';
import { estimateCostUsd } from './pricing';
import { toStrictSchema } from './schema';

/**
 * The food module's model calls (DECISIONS #33). A small, cheap model —
 * `claude-haiku-5-5` by default (FOOD_AI_MODEL) — not the coach's Opus. Every call returns strict
 * JSON (structured outputs) that is validated again with Zod before anything uses it, and nothing
 * here writes: the caller shows the result for the athlete to confirm.
 */
export interface FoodAiConfig {
  apiKey: string;
  model: string;
}

export type FoodAiResult<T> = { ok: true; value: T; usage: CallUsage } | { ok: false; error: string; usage?: CallUsage | undefined };

const READ_SYSTEM = `You read calorie and nutrition information from photos for a personal food log in Canada.

The photo is usually a Canadian Nutrition Facts table (bilingual — read the English), but it can be any food packaging, a restaurant or coffee-shop app screenshot (Starbucks, Tim Hortons), a menu board or a recipe card.

Report the values for ONE serving exactly as the source defines it — not per 100 g, unless the source only gives per-100 g values, in which case the serving is 100 g. Never scale or round values yourself.

- "Calories" is kcal. If energy is only given in kJ, convert it (kJ ÷ 4.184) and mark it low confidence.
- Fat, saturated, trans, carbohydrate, fibre, sugars and protein are grams; cholesterol, sodium, potassium, calcium and iron are milligrams. When only a % Daily Value is printed for a nutrient, use null — don't convert percentages.
- A nutrient that isn't shown is null with high confidence. Use low confidence when a digit is blurry, cut off, glared, or you had to infer it.
- servingMeasures lists everything the serving is stated to equal, with each amount as a number: "3/4 cup (175 g)" is 0.75 cup and 175 g; "1 bar (40 g)" is 1 bar and 40 g; a grande drink is 1 grande (add its ml if shown).
- name is short and specific, the way someone would find it in their own food list. brand only when visible.
- imageType says what the photo is: a nutrition label or packaging, an app or website screenshot, or something else.
- found is false when there is no calorie or nutrition information in the image; then return null values.`;

const PARSE_SYSTEM = `You turn a short food-logging phrase into items from the person's own food list, for their food log.

Only match items that are in the catalog below. Each catalog line is: id | name | other names | units | usual portion. Match on meaning, not just spelling: "PB" is peanut butter, "my oats" can be their overnight-oats recipe, "the usual breakfast" can be a saved meal. When the phrase names something that is not in the catalog, return it with ref null — never pick a different food just because it is close. When two or more catalog entries fit equally well, pick the most likely and list the others in alternatives.

Quantities: only when said ("half a bagel" → 0.5, "two eggs" → 2, "a bit of" → null). Use a unit only when it was said and it is one of that item's listed units ("100 g", "a cup"); otherwise null — the app fills in their usual portion. Never invent amounts.

Meals: use one of the meal names given if the phrase says which meal; otherwise null. dayOffset is 0 unless the phrase moves the day ("yesterday" → -1).

When you are given a current list and a change ("make it half a bagel", "add a latte", "no butter"), return the whole updated list: keep unchanged items exactly as they are (same ref, quantity and unit), apply the change, and don't drop anything that wasn't removed.`;

const MATCH_SYSTEM = `You match recipe ingredients to the person's own food list, so a recipe can be priced from foods they have actually logged.

Each catalog line is: id | name | other names | units | usual portion. Only match an ingredient to a catalog food that is the same food in a compatible form: "chicken thighs" matches "Chicken thighs, boneless skinless"; "rice" (dry) does not match "Rice, cooked" unless nothing else fits and the amount makes sense either way; "Greek yogurt" matches "Plain Greek yogurt 2%". When no catalog food is that ingredient, return ref null — never pick a different food because it is close (feta is not "cheddar", olive oil is not "butter"). When two catalog foods fit, pick the most likely and list the other in alternatives.

Units: if the ingredient's unit is not one of the matched food's listed units and the food has no g/ml unit, give quantity and unit converted to one of its listed units (e.g. 300 g of eggs → 6 "large egg"); otherwise quantity and unit are null.`;

const ingredientMatchSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int().describe('The ingredient number given.'),
      ref: z.string().nullable().describe('The catalog id of the same food, or null.'),
      alternatives: z.array(z.string()).describe('Other catalog ids that could be this ingredient (at most 2).'),
      quantity: z.number().nullable().describe('Only when converting to one of the food’s listed units; else null.'),
      unit: z.string().nullable().describe('Only when converting; else null.'),
    }),
  ),
});
export type IngredientMatchResult = z.infer<typeof ingredientMatchSchema>;

export interface MatchIngredientsInput {
  /** Foods only — recipes and meals aren't ingredients. */
  catalog: CatalogEntry[];
  items: { name: string; quantity: number; unit: string }[];
}

/** One line of the catalog the parser sees — the athlete's own foods, recipes and meals. */
export interface CatalogEntry {
  /** Short id ("f12", "r3", "m1"), mapped back by the caller. */
  id: string;
  name: string;
  aliases: string[];
  units: string[];
  usual?: string | undefined;
}

export interface ParsePhraseInput {
  phrase: string;
  catalog: CatalogEntry[];
  slots: string[];
  /** e.g. "Sun Nov 1, 2026" and "07:42" — context for "this morning" / "yesterday". */
  viewedDay: string;
  now: string;
  /** The current list when refining. */
  draft?: { ref: string | null; heard: string; quantity: number; unit: string }[] | undefined;
}

const catalogLine = (e: CatalogEntry) => [e.id, e.name, e.aliases.join(', ') || '-', e.units.join(', '), e.usual ?? '-'].join(' | ');

function usageOf(res: Anthropic.Message): CallUsage {
  const usage = {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
  };
  return { ...usage, model: res.model, costUsd: estimateCostUsd(res.model, usage), stopReason: res.stop_reason };
}

/** The JSON schema the API constrains output to, from the same Zod schema used to validate it. */
export const jsonFormat = (schema: z.ZodType) => ({ type: 'json_schema' as const, schema: toStrictSchema(z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>) });

export class FoodAi {
  private readonly client: Anthropic;

  constructor(
    private readonly config: FoodAiConfig,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 90_000 });
  }

  get model() {
    return this.config.model;
  }

  /**
   * One structured call: content in, a Zod-validated value out. Thinking blocks come first on
   * small models too, so the answer is found by block type, not position.
   */
  private structured<T>(args: { system: string; content: Anthropic.ContentBlockParam[]; schema: z.ZodType<T>; effort: 'low' | 'medium'; maxTokens: number }): Promise<FoodAiResult<T>> {
    return this.structuredWithSystem({ ...args, system: [args.system] });
  }

  /** The last system block carries the cache breakpoint, so instructions + catalog are one cached prefix. */
  private async structuredWithSystem<T>(args: { system: string[]; content: Anthropic.ContentBlockParam[]; schema: z.ZodType<T>; effort: 'low' | 'medium'; maxTokens: number }): Promise<FoodAiResult<T>> {
    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create({
        model: this.config.model,
        max_tokens: args.maxTokens,
        system: args.system.map((text, i) => ({ type: 'text' as const, text, ...(i === args.system.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}) })),
        output_config: { effort: args.effort, format: jsonFormat(args.schema) },
        messages: [{ role: 'user', content: args.content }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'Claude rejected the API key.' };
      if (err instanceof Anthropic.RateLimitError) return { ok: false, error: 'Claude is busy right now — try again in a minute.' };
      if (err instanceof Anthropic.APIError) return { ok: false, error: `Claude couldn't read that (${err.status ?? 'error'}).` };
      return { ok: false, error: 'Claude is not responding.' };
    }
    const usage = usageOf(res);
    if (res.stop_reason === 'refusal') return { ok: false, error: 'Claude declined to read this one — enter it by hand.', usage };
    if (res.stop_reason === 'max_tokens') return { ok: false, error: 'The answer was cut off — try again.', usage };
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return { ok: false, error: 'No answer came back — try again.', usage };
    let json: unknown;
    try {
      json = JSON.parse(text.text);
    } catch {
      return { ok: false, error: 'The answer wasn’t valid — try again.', usage };
    }
    const parsed = args.schema.safeParse(json);
    return parsed.success ? { ok: true, value: parsed.data, usage } : { ok: false, error: 'The answer didn’t match the expected shape — try again.', usage };
  }

  /**
   * "Bagel and butter for breakfast" → items from the athlete's catalog. The catalog is the cached system
   * prefix (it changes only when they add a food), so repeat calls are cheap. Low effort: this is
   * matching, not reasoning.
   */
  async parsePhrase(input: ParsePhraseInput): Promise<FoodAiResult<PhraseParse>> {
    const catalog = input.catalog.length ? input.catalog.map(catalogLine).join('\n') : '(empty — nothing has been added yet)';
    const draft = input.draft?.length
      ? `\n\nCurrent list:\n${input.draft.map((d) => `- ${d.ref ?? 'not in catalog'} | "${d.heard}" | ${d.quantity} ${d.unit}`).join('\n')}\n\nChange: ${input.phrase}`
      : `\n\nPhrase: ${input.phrase}`;
    return this.structuredWithSystem({
      system: [PARSE_SYSTEM, `Catalog:\n${catalog}`],
      content: [{ type: 'text', text: `Meals: ${input.slots.join(', ')}\nDay being viewed: ${input.viewedDay}. Time now: ${input.now}.${draft}` }],
      schema: phraseParseSchema,
      effort: 'low',
      maxTokens: 4000,
    });
  }

  /**
   * A coach recipe's ingredients → the athlete's foods. Same catalog idea as
   * `parsePhrase`; the caller checks every id and prices the lines in code.
   */
  async matchIngredients(input: MatchIngredientsInput): Promise<FoodAiResult<IngredientMatchResult>> {
    const catalog = input.catalog.length ? input.catalog.map(catalogLine).join('\n') : '(empty — nothing has been added yet)';
    return this.structuredWithSystem({
      system: [MATCH_SYSTEM, `Catalog:\n${catalog}`],
      content: [{ type: 'text', text: `Ingredients:\n${input.items.map((it, i) => `${i}. ${it.name} — ${it.quantity} ${it.unit}`).join('\n')}` }],
      schema: ingredientMatchSchema,
      effort: 'low',
      maxTokens: 6000,
    });
  }

  /** Read a nutrition label, app screenshot or anything with calories on it. */
  readNutrition(input: PhotoReadInput): Promise<FoodAiResult<NutritionReading>> {
    return this.structured({
      system: READ_SYSTEM,
      content: [
        ...input.images.map((img): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
        { type: 'text', text: input.images.length > 1 ? 'Both photos show the same food (e.g. the label and the front of the pack). Read it.' : 'Read it.' },
      ],
      schema: nutritionReadingSchema,
      effort: 'medium',
      maxTokens: 8000,
    });
  }
}
