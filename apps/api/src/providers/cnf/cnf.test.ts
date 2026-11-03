import { describe, expect, it } from 'vitest';
import { buildCnfFoods, csvRecords, parseCsv } from './index';

describe('parseCsv', () => {
  it('handles a BOM, quoted commas, doubled quotes and CRLF', () => {
    expect(parseCsv('﻿a,b\r\n1,"x, ""y"""\r\n2,z\n')).toEqual([
      ['a', 'b'],
      ['1', 'x, "y"'],
      ['2', 'z'],
    ]);
    expect(csvRecords('Code,Name\n125,"Egg, chicken"')).toEqual([{ Code: '125', Name: 'Egg, chicken' }]);
  });
});

describe('buildCnfFoods', () => {
  const files = {
    foodGroup: 'CNF_Food_Group_Code,CNF_Food_Group_Description_EN\n1,Dairy and Egg Products\n',
    foodName:
      'Food_Code,Food_Description_EN,Food_Description_FR,Alternate_Description_EN,CNF_Food_Group_Code\n' +
      '125,"Egg, chicken, whole, fresh or frozen, raw","Oeuf, poule",,1\n' +
      '999,No energy value,,,1\n',
    nutrientAmount:
      'Food_Code,Nutrient_Code,Nutrient_Amount\n' +
      '125,208,152.000000000\n125,203,12.4\n125,204,10.2\n125,205,1.1\n125,307,129\n125,999,5\n' +
      '999,203,1\n',
    measureName: 'Measure_Code,Measure_Description_and_Unit_EN\n10,1 large egg\n11,total refuse\n12,125 ml\n',
    measureWeight:
      'Food_Code,Measure_Type_Code,Measure_Code,Measure_Weight_Conversion\n' +
      '125,6,10,52.61\n125,3,11,12\n125,6,12,128.381\n125,6,10,52.61\n',
  };

  it('joins names, nutrients per 100 g and household measures', () => {
    const [egg, ...rest] = buildCnfFoods(files);
    expect(rest).toEqual([]);
    expect(egg).toEqual({
      code: '125',
      name: 'Egg, chicken, whole, fresh or frozen, raw',
      nameFr: 'Oeuf, poule',
      alt: undefined,
      group: 'Dairy and Egg Products',
      per100g: { kcal: 152, protein: 12.4, fat: 10.2, carbs: 1.1, sodiumMg: 129 },
      portions: [
        { label: '1 large egg', grams: 52.61 },
        { label: '125 ml', grams: 128.38 },
      ],
    });
  });

  it('falls back to kJ when kcal is missing', () => {
    const [f] = buildCnfFoods({ ...files, nutrientAmount: 'Food_Code,Nutrient_Code,Nutrient_Amount\n125,268,418.4\n' });
    expect(f!.per100g).toEqual({ kcal: 100, fat: 0, carbs: 0, protein: 0 });
  });
});
