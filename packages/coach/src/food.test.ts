import type Anthropic from '@anthropic-ai/sdk';
import { nutritionReadingSchema, phraseParseSchema, type NutritionReading } from '@cycling-coach/shared';
import { describe, expect, it } from 'vitest';
import { FoodAi, jsonFormat } from './food';

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
  });

  it('sends the images with a strict JSON schema to the small model', async () => {
    const { client, calls } = fake({ content: [{ type: 'text', text: JSON.stringify(reading) }], stop_reason: 'end_turn' });
    const ai = new FoodAi({ apiKey: 'k', model: 'claude-haiku-5-5' }, client);
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
    const r = await new FoodAi({ apiKey: 'k', model: 'm' }, client).readNutrition(input);
    expect(r.ok).toBe(true);
  });

  it('reports refusals and bad output without throwing', async () => {
    const refused = await new FoodAi({ apiKey: 'k', model: 'm' }, fake({ content: [], stop_reason: 'refusal' }).client).readNutrition(input);
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/declined/) });
    const garbage = await new FoodAi({ apiKey: 'k', model: 'm' }, fake({ content: [{ type: 'text', text: '{"found": true}' }], stop_reason: 'end_turn' }).client).readNutrition(input);
    expect(garbage).toMatchObject({ ok: false });
  });
});

describe('FoodAi.parsePhrase', () => {
  it('sends the catalog as the cached system prefix and the change with the current list', async () => {
    const parse = { dayOffset: 0, slot: 'Breakfast', time: null, items: [{ heard: 'half a bagel', ref: 'f1', alternatives: [], quantity: 0.5, unit: null }] };
    const { client, calls } = fake({ content: [{ type: 'text', text: JSON.stringify(parse) }], stop_reason: 'end_turn' });
    const r = await new FoodAi({ apiKey: 'k', model: 'claude-haiku-5-5' }, client).parsePhrase({
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
