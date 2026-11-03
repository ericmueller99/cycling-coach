import { describe, expect, it } from 'vitest';
import { OpenFoodFacts, offToFood } from './index';

describe('offToFood', () => {
  it('uses per-serving values with the serving weight when OFF has them', () => {
    const f = offToFood(
      {
        code: '0064200116473',
        product_name: 'Greek yogurt plain 0%',
        brands: 'Oikos, Danone',
        serving_size: '175 g',
        serving_quantity: '175',
        nutriments: { 'energy-kcal_serving': 100, proteins_serving: 18, carbohydrates_serving: 6, fat_serving: 0, sodium_serving: 0.065, 'energy-kcal_100g': 57 },
      },
      '0064200116473',
    )!;
    expect(f).toMatchObject({
      name: 'Greek yogurt plain 0%',
      brand: 'Oikos',
      source: 'off',
      barcodes: ['0064200116473'],
      servingLabel: '175 g',
      measures: [{ unit: 'g', amount: 175 }],
      nutrients: { kcal: 100, protein: 18, carbs: 6, fat: 0, sodiumMg: 65 },
    });
  });

  it('falls back to per 100 g, and to kJ when kcal is missing', () => {
    const f = offToFood({ product_name: 'Oats', nutriments: { energy_100g: 1569, proteins_100g: 13 } }, '123')!;
    expect(f.measures).toEqual([{ unit: 'g', amount: 100 }]);
    expect(f.nutrients).toEqual({ kcal: 375, fat: 0, carbs: 0, protein: 13 });
  });

  it('is null without a name or any energy value', () => {
    expect(offToFood({ product_name: 'Mystery', nutriments: {} }, '1')).toBeNull();
    expect(offToFood({ nutriments: { 'energy-kcal_100g': 10 } }, '1')).toBeNull();
  });
});

describe('OpenFoodFacts.product', () => {
  it('returns null for unknown products', async () => {
    const off = new OpenFoodFacts((async () => new Response(JSON.stringify({ status: 0 }), { status: 200 })) as unknown as typeof fetch);
    expect(await off.product('999')).toBeNull();
  });
});
