import Anthropic from '@anthropic-ai/sdk';
import { estimateAdjustmentSchema, estimateReadingSchema, foodAdjustmentSchema, nutritionReadingSchema, phraseParseSchema, type NutritionReading } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { FoodAi, jsonFormat } from './food';
import { DEFAULT_ROUTER } from './router';

const v = (value: number | null, confidence: 'high' | 'low' = 'high') => ({ value, confidence });
const reading: NutritionReading = {
  found: true,
  imageType: 'label',
  name: 'Greek yogurt, plain 0%',
  brand: '',
  barcode: '',
  servingText: 'Per 3/4 cup (175 g)',
  servingMeasures: [
    { amount: 0.75, unit: 'cup' },
    { amount: 175, unit: 'g' },
  ],
  nutrients: {
    kcal: v(100),
    fat: v(0),
    satFat: v(0),
    transFat: v(0),
    carbs: v(6),
    fibre: v(0),
    sugars: v(6, 'low'),
    protein: v(18),
    cholesterolMg: v(10),
    sodiumMg: v(65),
    potassiumMg: v(null, 'low'),
    calciumMg: v(null),
    ironMg: v(null),
  },
  aliases: ['greek yogurt'],
  note: '',
};

function fake(response: { content: unknown[]; stop_reason: string }) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(params);
        return { ...response, model: 'claude-haiku-5-5', usage: { input_tokens: 1500, output_tokens: 400 } };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const input = { images: [{ mediaType: 'image/jpeg' as const, data: 'x'.repeat(200) }] };

describe('FoodAi.readNutrition', () => {
  it('keeps the schema within the API limit of 16 nullable fields', () => {
    const count = (s: unknown): number =>
      !s || typeof s !== 'object'
        ? 0
        : (Array.isArray((s as { type?: unknown }).type) || (s as { anyOf?: unknown }).anyOf ? 1 : 0) +
          Object.values(s as Record<string, unknown>).reduce<number>((n, v) => n + count(v), 0);
    expect(count(jsonFormat(nutritionReadingSchema).schema)).toBeLessThanOrEqual(16);
    expect(count(jsonFormat(phraseParseSchema).schema)).toBeLessThanOrEqual(16);
    expect(count(jsonFormat(foodAdjustmentSchema).schema)).toBeLessThanOrEqual(16);
    expect(count(jsonFormat(estimateReadingSchema).schema)).toBeLessThanOrEqual(16);
    expect(count(jsonFormat(estimateAdjustmentSchema).schema)).toBeLessThanOrEqual(16);
  });

  it('sends the images with a strict JSON schema to the small model', async () => {
    const { client, calls } = fake({ content: [{ type: 'text', text: JSON.stringify(reading) }], stop_reason: 'end_turn' });
    const ai = new FoodAi({ apiKey: 'k' }, client);
    const r = await ai.readNutrition(input);
    expect(r.ok && r.value.name).toBe('Greek yogurt, plain 0%');
    const call = calls[0] as { model: string; output_config: { effort: string; format: { type: string; schema: { additionalProperties: boolean; required: string[] } } }; messages: { content: { type: string }[] }[] };
    expect(call.model).toBe('claude-haiku-5-5');
    expect(call.output_config.effort).toBe('medium');
    expect(call.output_config.format.type).toBe('json_schema');
    expect(call.output_config.format.schema.additionalProperties).toBe(false);
    expect(call.output_config.format.schema.required).toContain('nutrients');
    expect(call.messages[0]!.content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(r.usage?.costUsd).toBeGreaterThan(0);
  });

  it('finds the answer after thinking blocks', async () => {
    const { client } = fake({
      content: [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: JSON.stringify(reading) },
      ],
      stop_reason: 'end_turn',
    });
    const r = await new FoodAi({ apiKey: 'k' }, client).readNutrition(input);
    expect(r.ok).toBe(true);
  });

  it('reports refusals and bad output without throwing', async () => {
    const refused = await new FoodAi({ apiKey: 'k' }, fake({ content: [], stop_reason: 'refusal' }).client).readNutrition(input);
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/declined/) });
    const garbage = await new FoodAi({ apiKey: 'k' }, fake({ content: [{ type: 'text', text: '{"found": true}' }], stop_reason: 'end_turn' }).client).readNutrition(input);
    expect(garbage).toMatchObject({ ok: false });
  });
});

describe('FoodAi.parsePhrase', () => {
  it('sends the catalog as the cached system prefix and the change with the current list', async () => {
    const parse = { dayOffset: 0, slot: 'Breakfast', time: null, items: [{ heard: 'half a bagel', ref: 'f1', alternatives: [], quantity: 0.5, unit: null }] };
    const { client, calls } = fake({ content: [{ type: 'text', text: JSON.stringify(parse) }], stop_reason: 'end_turn' });
    const r = await new FoodAi({ apiKey: 'k' }, client).parsePhrase({
      phrase: 'make it half a bagel',
      catalog: [{ id: 'f1', name: 'Blueberry bagel', aliases: ['bagel'], units: ['bagel', 'g'], usual: '1 bagel' }],
      slots: ['Breakfast', 'Lunch'],
      viewedDay: 'Sun Nov 1',
      now: '07:40',
      draft: [{ ref: 'f1', heard: 'bagel', quantity: 1, unit: 'bagel' }],
    });
    expect(r.ok && r.value.items[0]!.quantity).toBe(0.5);
    const call = calls[0] as { system: { text: string; cache_control?: unknown }[]; output_config: { effort: string }; messages: { content: { text: string }[] }[] };
    expect(call.system).toHaveLength(2);
    expect(call.system[0]!.cache_control).toBeUndefined();
    expect(call.system[1]).toMatchObject({ text: expect.stringContaining('f1 | Blueberry bagel | bagel | bagel, g | 1 bagel'), cache_control: { type: 'ephemeral' } });
    expect(call.output_config.effort).toBe('low');
    expect(call.messages[0]!.content[0]!.text).toContain('Current list:\n- f1 | "bagel" | 1 bagel\n\nChange: make it half a bagel');
  });
});

describe('FoodAi.adjustFood', () => {
  const answer = { reply: 'Whipped cream is about 80 kcal (an estimate).', changes: [{ nutrient: 'kcal', delta: -80 }], name: 'Mocha, no whip', note: 'No whip: about 80 kcal less (estimate)' };
  const food = { name: 'Mocha', brand: 'Starbucks', servingLabel: 'Grande 473 ml', nutrients: { kcal: 370, fat: 15 } };

  it('sends the current values and the conversation, and returns the checked answer', async () => {
    const { client, calls } = fake({ content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn' });
    const res = await new FoodAi({ apiKey: 'x' }, client).adjustFood({ food, turns: [{ role: 'user', text: 'no drizzle' }, { role: 'assistant', text: 'About 15 kcal less.' }], message: 'no whipped cream' });
    expect(res).toMatchObject({ ok: true, value: answer });
    const text = JSON.stringify(calls[0]!['messages']);
    for (const part of ['Mocha (Starbucks)', 'Grande 473 ml', 'kcal: 370', 'They said: no drizzle', 'You said: About 15 kcal less.', 'They say: no whipped cream']) expect(text).toContain(part);
    expect(text).not.toContain('"image"');
  });

  it('turns down a nutrient the app does not have', async () => {
    const { client } = fake({ content: [{ type: 'text', text: JSON.stringify({ ...answer, changes: [{ nutrient: 'caffeine', delta: -1 }] }) }], stop_reason: 'end_turn' });
    expect((await new FoodAi({ apiKey: 'x' }, client).adjustFood({ food, turns: [], message: 'no whip' })).ok).toBe(false);
  });
});

/** Answers each request in turn, so a paused or refused call can be followed by another. */
function scripted(responses: ({ content: unknown[]; stop_reason: string; usage?: Record<string, unknown> } | Error)[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(structuredClone(params));
        const next = responses[calls.length - 1]!;
        if (next instanceof Error) throw next;
        return { model: 'claude-sonnet-5-5', usage: { input_tokens: 1500, output_tokens: 400 }, ...next };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe('FoodAi.estimateMeal', () => {
  const answer = { dish: 'Sirloin dinner', found: [], items: [], questions: [] };
  const photo = { mediaType: 'image/jpeg' as const, data: 'x'.repeat(200), kind: 'menu' as const };
  const plate = { ...photo, kind: 'plate' as const };
  const router = () => ({ ...DEFAULT_ROUTER, estimate: { model: 'claude-sonnet-5-5', effort: 'low' as const } });
  const restaurant = { kind: 'restaurant' as const, search: false };
  type Body = { model: string; system: { text: string }[]; tools?: { type: string; max_uses: number; user_location: { timezone?: string } }[]; output_config: { effort: string }; messages: { role: string; content: { type: string; text?: string }[] }[] };
  const json = (text: unknown) => ({ type: 'text', text: JSON.stringify(text) });

  it('uses the estimate job, not the small model, and says what each photo is', async () => {
    const { client, calls } = fake({ content: [json(answer)], stop_reason: 'end_turn' });
    const r = await new FoodAi({ apiKey: 'k', router }, client).estimateMeal({ ...restaurant, place: 'The Keg', text: 'A steak', images: [photo] });
    expect(r.ok && r.value.search).toBe('off');
    const body = calls[0] as Body;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.output_config.effort).toBe('low');
    expect(body.tools).toBeUndefined();
    expect(body.system[0]!.text).toContain('from a restaurant');
    expect(body.system[0]!.text).toContain("You can't look it up");
    const content = body.messages[0]!.content;
    expect(content.map((b) => b.type)).toEqual(['text', 'image', 'text']);
    expect(content[0]?.text).toBe('Photo of the menu:');
    expect(content[2]?.text).toContain('Place: The Keg');
    expect(content[2]?.text).toContain('They said: A steak');
  });

  it('goes by the photos when nothing was said', async () => {
    const { client, calls } = fake({ content: [json(answer)], stop_reason: 'end_turn' });
    await new FoodAi({ apiKey: 'k', router }, client).estimateMeal({ ...restaurant, images: [photo] });
    const body = calls[0] as Body;
    expect(body.messages[0]!.content.at(-1)?.text).toContain('go by the photos');
  });

  it('estimates a home-cooked meal from what is in it, with no search', async () => {
    const { client, calls } = fake({ content: [json(answer)], stop_reason: 'end_turn' });
    await new FoodAi({ apiKey: 'k', router }, client).estimateMeal({ kind: 'home', search: false, dish: 'Lasagna', text: 'Beef, ricotta, mozzarella', images: [plate] });
    const body = calls[0] as Body;
    expect(body.tools).toBeUndefined();
    expect(body.system[0]!.text).toContain('home-cooked');
    expect(body.system[0]!.text).not.toContain('Restaurant food carries');
    expect(body.messages[0]!.content[0]?.text).toBe('Photo of the food:');
    expect(body.messages[0]!.content.at(-1)?.text).toContain('They called it: Lasagna');
    expect(body.messages[0]!.content.at(-1)?.text).toContain("What's in it, as they said: Beef, ricotta, mozzarella");
  });

  it('searches for a named place, and keeps the pages the search returned', async () => {
    const url = 'https://www.example-grill.ca/nutrition';
    const { client, calls } = scripted([
      {
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Example Grill nutrition' } },
          { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url, title: 'Nutrition', encrypted_content: 'e', page_age: null }] },
          { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: { url } },
          { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: `${url}/burgers`, retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '…' }, title: null, citations: null } } },
          { type: 'text', text: 'Found it.' },
          json(answer),
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 9000, output_tokens: 600, server_tool_use: { web_search_requests: 1 } },
      },
    ]);
    const r = await new FoodAi({ apiKey: 'k', router }, client).estimateMeal({ kind: 'restaurant', search: true, place: 'Example Grill', text: 'Burger', images: [] }, { timezone: 'America/Vancouver' });
    const body = calls[0] as Body;
    expect(body.tools?.[0]).toMatchObject({ type: 'web_search_20260209', max_uses: 3, user_location: { country: 'CA', timezone: 'America/Vancouver' } });
    expect(body.tools?.[1]).toMatchObject({ type: 'web_fetch_20260209', max_uses: 2 });
    expect(body.system[0]!.text).toContain('search the web before you answer');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ search: 'found', sources: [url, `${url}/burgers`], reading: answer });
    expect(r.usage.webSearches).toBe(1);
    expect(r.usage.costUsd).toBeCloseTo((9000 * 2 + 600 * 10) / 1e6 + 0.01);
  });

  it('gives Haiku the basic search', async () => {
    const { client, calls } = fake({ content: [json(answer)], stop_reason: 'end_turn' });
    const haiku = () => ({ ...DEFAULT_ROUTER, estimate: { model: 'claude-haiku-5-5', effort: 'low' as const } });
    await new FoodAi({ apiKey: 'k', router: haiku }, client).estimateMeal({ kind: 'restaurant', search: true, place: 'Example Grill', images: [photo] });
    expect((calls[0] as Body).tools?.map((t) => t.type)).toEqual(['web_search_20250305']);
  });

  it('never searches without a place, or for a home meal', async () => {
    const { client, calls } = fake({ content: [json(answer)], stop_reason: 'end_turn' });
    const ai = new FoodAi({ apiKey: 'k', router }, client);
    await ai.estimateMeal({ kind: 'restaurant', search: true, images: [photo] });
    await ai.estimateMeal({ kind: 'home', search: true, images: [plate] });
    expect(calls.map((c) => (c as Body).tools)).toEqual([undefined, undefined]);
  });

  it('sends a paused turn back to finish, and adds up both requests', async () => {
    const paused = [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }];
    const { client, calls } = scripted([
      { content: paused, stop_reason: 'pause_turn' },
      { content: [json(answer)], stop_reason: 'end_turn' },
    ]);
    const r = await new FoodAi({ apiKey: 'k', router }, client).estimateMeal({ kind: 'restaurant', search: true, place: 'Example Grill', images: [photo] });
    expect(calls).toHaveLength(2);
    const second = calls[1] as Body;
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(r.ok && r.usage.inputTokens).toBe(3000);
    expect(r.ok && r.value.search).toBe('none');
  });

  it('estimates without search when the request with it is refused', async () => {
    const { client, calls } = scripted([new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'web search is disabled' } }, 'web search is disabled', new Headers()), { content: [json(answer)], stop_reason: 'end_turn' }]);
    const r = await new FoodAi({ apiKey: 'k', router }, client).estimateMeal({ kind: 'restaurant', search: true, place: 'Example Grill', images: [photo] });
    expect(calls.map((c) => !!(c as Body).tools)).toEqual([true, false]);
    expect((calls[1] as Body).system[0]!.text).toContain("You can't look it up");
    expect(r.ok && r.value.search).toBe('failed');
  });
});

describe('FoodAi.adjustEstimate', () => {
  const item = { name: 'Fries', why: '', unit: 'side', quantity: 1, kcal: 400, low: 300, high: 500, protein: 5, carbs: 50, fat: 20, alcohol: 0, sizes: [], modifiers: [], qty: 0.5, scale: 1, size: -1, mods: [], assumed: '' };

  it('sends the items as they stand, on the small model', async () => {
    const { client, calls } = fake({ content: [{ type: 'text', text: JSON.stringify({ reply: 'Done.', changes: [], removed: [], added: [] }) }], stop_reason: 'end_turn' });
    await new FoodAi({ apiKey: 'k' }, client).adjustEstimate({ kind: 'restaurant', items: [item], message: 'no salt' });
    const body = calls[0] as { model: string; messages: { content: { text: string }[] }[] };
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.messages[0]!.content[0]!.text).toContain('0. Fries, 0.5 side: 200 kcal (150-250)');
  });
});
