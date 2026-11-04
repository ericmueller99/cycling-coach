import Anthropic from '@anthropic-ai/sdk';
import { foodAdjustmentSchema, nutritionReadingSchema, phraseParseSchema, type FoodAdjustInput, type FoodAdjustment, type NutritionReading, type PhotoReadInput, type PhraseParse } from '@cycling-coach/shared';
import { z } from 'zod';
import type { CallUsage } from './engine';
import { priceUsage } from './pricing';
import { defaultRouter, type RouterSource } from './router';
import { toStrictSchema } from './schema';

/**
 * The food module's model calls (DECISIONS #33). A small, cheap model —
 * the router's `small` job, `claude-haiku-5-5` by default — not the coach's Opus. Every call returns strict
 * JSON (structured outputs) that is validated again with Zod before anything uses it, and nothing
 * here writes: the caller shows the result for the athlete to confirm.
 */
export interface FoodAiConfig {
  apiKey: string;
  /** Read per call, so a change applies straight away. Defaults to `DEFAULT_ROUTER`. */
  router?: RouterSource | undefined;
}

export type FoodAiResult<T> = { ok: true; value: T; usage: CallUsage } | { ok: false; error: string; usage?: CallUsage | undefined };

const READ_SYSTEM = `You read calorie and nutrition information from photos for a personal food log in Canada.

The photo is usually a Canadian Nutrition Facts table (bilingual — read the English), but it can be any food packaging, a restaurant or coffee-shop app screenshot (Starbucks, Tim Hortons), a menu board or a recipe card.

Report the values for ONE serving exactly as the source defines it — not per 100 g, unless the source only gives per-100 g values, in which case the serving is 100 g. Never scale or round values yourself.

- "Calories" is kcal. If energy is only given in kJ, convert it (kJ ÷ 4.184) and mark it low confidence.
- Fat, saturated, trans, carbohydrate, fibre, sugars and protein are grams; cholesterol, sodium, potassium, calcium and iron are milligrams. When only a % Daily Value is printed for a nutrient, use null — don't convert percentages.
- A nutrient that isn't shown is null with high confidence. Use low confidence when a digit is blurry, cut off, glared, or you had to infer it.
- servingMeasures lists everything the serving is stated to equal, with each amount as a number: "3/4 cup (175 g)" is 0.75 cup and 175 g; "1 bar (40 g)" is 1 bar and 40 g; a grande drink is 1 grande (add its ml if shown); a single item with no weight shown, like a coffee-shop sandwich, is 1 sandwich.
- name is short and specific, the way someone would find it in their own food list. brand only when visible.
- imageType says what the photo is: a nutrition label or packaging, an app or website screenshot, or something else.
- found is false when there is no calorie or nutrition information in the image; then return null values.`;

const ADJUST_SYSTEM = `You help someone correct a food's nutrition values for their personal food log in Canada, before they save it. The values came from a label or an app screen and describe the standard item. They tell you how theirs was different: "no whipped cream", "oat milk instead", "extra shot".

Work out how much that changes ONE serving, from what you know of typical ingredients and portions. These are estimates, never official figures, and the reply says so.

- changes lists only the nutrients that move, as a delta: negative for less, positive for more. Never give the new total; the app does the sums. Only use nutrients that have a value in the current list.
- Cover every listed nutrient the change really affects, and keep them consistent: saturated and trans fat are part of fat, sugars and fibre are part of carbohydrate, and the calories should fit the macros (9 per gram of fat, 4 per gram of carbohydrate or protein).
- The current values already include anything marked as applied. A change marked as not applied isn't in them. Never repeat a change unless they ask for more.
- reply is two or three plain sentences: what you assumed, and about how much it changes. If one missing detail would really change the estimate, ask that one question instead and leave changes empty.
- If you can't estimate it, or it isn't about this food, say so and leave changes empty. Never invent numbers.
- A different amount of the same food ("I only had half") isn't a change to the food. Leave changes empty and say to set the portion when logging it.
- name is the food's name with the change in it, kept short, only when changes isn't empty; otherwise empty.
- note is one short line for the food's notes, like "No whipped cream: about 80 kcal less (estimate)", only when changes isn't empty; otherwise empty.`;

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
  const { usage, costUsd } = priceUsage(res.model, res.usage);
  return { ...usage, model: res.model, costUsd, stopReason: res.stop_reason };
}

/** The JSON schema the API constrains output to, from the same Zod schema used to validate it. */
export const jsonFormat = (schema: z.ZodType) => ({ type: 'json_schema' as const, schema: toStrictSchema(z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>) });

export class FoodAi {
  private readonly client: Anthropic;
  private readonly router: RouterSource;

  constructor(config: FoodAiConfig, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 90_000 });
    this.router = config.router ?? defaultRouter;
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
      const { small } = await this.router();
      res = await this.client.messages.create({
        model: small,
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

  /**
   * "No whipped cream" → how much a food's values move. Text only: the form already holds what the
   * photo said. The caller shows it as a proposal; nothing applies until the user says so.
   */
  adjustFood(input: FoodAdjustInput): Promise<FoodAiResult<FoodAdjustment>> {
    const { food, turns, message } = input;
    const lines = [
      `Food: ${food.name}${food.brand ? ` (${food.brand})` : ''}`,
      ...(food.servingLabel ? [`One serving: ${food.servingLabel}`] : []),
      ...(food.notes ? [`Notes: ${food.notes}`] : []),
      `Current values per serving:\n${Object.entries(food.nutrients)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n')}`,
      ...(turns.length ? [`Conversation so far:\n${turns.map((t) => `${t.role === 'user' ? 'They said' : 'You said'}: ${t.text}`).join('\n')}`] : []),
      `They say: ${message}`,
    ];
    return this.structured({
      system: ADJUST_SYSTEM,
      content: [{ type: 'text', text: lines.join('\n\n') }],
      schema: foodAdjustmentSchema,
      effort: 'medium',
      maxTokens: 4000,
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
