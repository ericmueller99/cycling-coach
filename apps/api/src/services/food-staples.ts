import { rankStaples } from '@cycling-coach/core';
import { cnfSearchIndex, countCnfFoods, getCnfFood, type Collections } from '@cycling-coach/db';
import type { StapleDetail, StapleSearchPayload, StapleSource } from '@cycling-coach/shared';
import type { ServiceFailure as Failure } from '../app';
import { UsdaError, type UsdaClient } from '../providers/usda';

type IndexItem = Awaited<ReturnType<typeof cnfSearchIndex>>[number];

/** The CNF name index is ~6,000 short rows; it's held in memory and refreshed hourly. */
const INDEX_TTL_MS = 60 * 60 * 1000;
const LIMIT = 30;

/**
 * Staples search: the Canadian Nutrient File first, USDA FoodData Central as
 * the fallback. Results are reference data — nothing reaches the user's foods until they save one.
 */
export class StaplesService {
  private index: { at: number; items: IndexItem[] } | null = null;

  constructor(
    private readonly c: Collections,
    private readonly usda: UsdaClient | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async cnfIndex(): Promise<IndexItem[]> {
    const at = this.now().getTime();
    if (!this.index || at - this.index.at > INDEX_TTL_MS) this.index = { at, items: await cnfSearchIndex(this.c) };
    return this.index.items;
  }

  async search(q: string, source: StapleSource): Promise<StapleSearchPayload> {
    if (source === 'usda') {
      if (!this.usda) return { source, results: [], unavailable: 'USDA search is not configured on the server.' };
      try {
        return { source, results: await this.usda.search(q) };
      } catch (err) {
        return { source, results: [], unavailable: err instanceof UsdaError ? err.message : 'USDA FoodData Central is not responding.' };
      }
    }
    const items = await this.cnfIndex();
    if (!items.length) return { source, results: [], unavailable: 'The Canadian Nutrient File has not been imported yet (pnpm food:import-cnf).' };
    return {
      source,
      results: rankStaples(items, q, LIMIT).map((it) => ({ source: 'cnf' as const, ref: it.code, name: it.name, group: it.group, kcalPer100g: it.kcal })),
    };
  }

  async detail(source: StapleSource, ref: string): Promise<StapleDetail | Failure> {
    if (source === 'usda') {
      if (!this.usda) return { error: 'USDA search is not configured on the server.', status: 503 };
      try {
        return (await this.usda.food(ref)) ?? { error: 'Not found.', status: 404 };
      } catch (err) {
        return { error: err instanceof UsdaError ? err.message : 'USDA FoodData Central is not responding.', status: 503 };
      }
    }
    const doc = await getCnfFood(this.c, ref);
    if (!doc) return { error: 'Not found.', status: 404 };
    return { source: 'cnf', ref: doc._id, name: doc.name, group: doc.group, kcalPer100g: doc.per100g.kcal, per100g: doc.per100g, portions: doc.portions };
  }

  /** For boot logging and seed: is the reference table there? */
  imported() {
    return countCnfFoods(this.c);
  }
}
