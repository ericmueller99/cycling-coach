import { describe, expect, it, vi } from 'vitest';
import { portionLabel, UsdaClient } from './index';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('UsdaClient', () => {
  it('searches generic foods only and maps kcal per 100 g', async () => {
    const fetch = vi.fn(async () =>
      json({ foods: [{ fdcId: 171287, description: 'Egg, whole, raw, fresh', dataType: 'SR Legacy', foodNutrients: [{ nutrientNumber: '208', value: 143 }] }] }),
    );
    const usda = new UsdaClient('KEY', fetch as unknown as typeof globalThis.fetch);
    expect(await usda.search('egg')).toEqual([{ source: 'usda', ref: '171287', name: 'Egg, whole, raw, fresh', group: 'SR Legacy', kcalPer100g: 143 }]);
    const url = new URL(String((fetch.mock.calls[0] as unknown as [string])[0]));
    expect(url.searchParams.get('dataType')).toBe('Foundation,SR Legacy');
    expect(url.searchParams.get('api_key')).toBe('KEY');
  });

  it('reads detail nutrients and portions; Atwater energy when 208 is missing', async () => {
    const fetch = vi.fn(async () =>
      json({
        fdcId: 1,
        description: 'Flour, wheat, all-purpose',
        dataType: 'Foundation',
        foodNutrients: [
          { nutrient: { number: '958' }, amount: 366 },
          { nutrient: { number: '203' }, amount: 10.9 },
          { nutrient: { number: '204' }, amount: 1.48 },
          { nutrient: { number: '205' }, amount: 77.3 },
        ],
        foodPortions: [
          { amount: 1, gramWeight: 125, measureUnit: { name: 'cup' } },
          { amount: 1, gramWeight: 50, modifier: 'large', measureUnit: { name: 'undetermined' } },
          { amount: 1, gramWeight: 125, measureUnit: { name: 'cup' } },
        ],
      }),
    );
    const d = await new UsdaClient('KEY', fetch as unknown as typeof globalThis.fetch).food('1');
    expect(d!.per100g).toEqual({ kcal: 366, protein: 10.9, fat: 1.48, carbs: 77.3 });
    expect(d!.portions).toEqual([
      { label: '1 cup', grams: 125 },
      { label: '1 large', grams: 50 },
    ]);
  });

  it('explains rate limits', async () => {
    const usda = new UsdaClient('DEMO_KEY', (async () => json({}, 429)) as unknown as typeof globalThis.fetch);
    await expect(usda.search('egg')).rejects.toThrow(/rate limit/);
  });

  it('labels portions the way core parses them', () => {
    expect(portionLabel({ amount: 1, modifier: 'cup (4.86 large eggs)', measureUnit: { name: 'undetermined' } })).toBe('1 cup (4.86 large eggs)');
    expect(portionLabel({ amount: 1, modifier: 'chopped', measureUnit: { name: 'cup' } })).toBe('1 cup chopped');
    expect(portionLabel({ amount: 1, measureUnit: { name: 'undetermined' } })).toBeNull();
  });
});
