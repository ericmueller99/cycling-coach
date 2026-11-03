import {
  bodyScanInputSchema,
  bodyScanPatchSchema,
  energyPatchSchema,
  foodInputSchema,
  foodLogBulkSchema,
  foodLogCopySchema,
  foodLogPatchSchema,
  foodLogRangeQuerySchema,
  foodPatchSchema,
  foodSettingsSchema,
  isoDateSchema,
  mealInputSchema,
  mealPatchSchema,
  recipeInputSchema,
  recipePatchSchema,
  foodParseInputSchema,
  photoReadInputSchema,
  stapleQuerySchema,
  stapleSources,
  type BarcodeLookup,
  type FoodParseInput,
  type FoodParseResult,
  type PhotoReadInput,
  type PhotoReadResult,
  type BodyScan,
  type BodyScanInput,
  type BodyScanPatch,
  type DaysPayload,
  type EnergyBudget,
  type EnergyPatch,
  type EnergyPayload,
  type Food,
  type FoodInput,
  type FoodLibrary,
  type FoodLogEntry,
  type FoodLogInput,
  type FoodLogPatch,
  type FoodLogPayload,
  type FoodPatch,
  type FoodSettings,
  type IsoDate,
  type Meal,
  type MealInput,
  type MealPatch,
  type Recipe,
  type RecipeDetail,
  type RecipeShare,
  type RecipeInput,
  type RecipePatch,
  type StapleDetail,
  type StapleSearchPayload,
  type StapleSource,
} from '@cycling-coach/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ServiceFailure } from '../app';
import { json, query } from '../lib/validate';

const budgetQuerySchema = z.object({ date: isoDateSchema });
/** At most ~13 weeks per request (the calendar asks for 4-week chunks). */
const daysQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.from <= q.to && Date.parse(q.to) - Date.parse(q.from) <= 92 * 86_400_000, 'from..to must be in order and at most 92 days');

/** The food module's port. Implemented by `services/food.ts`, wired in `server.ts`. */
export interface FoodServices {
  library(userId: string): Promise<FoodLibrary>;
  createFood(userId: string, input: FoodInput): Promise<Food | ServiceFailure>;
  updateFood(userId: string, id: string, patch: FoodPatch): Promise<Food | ServiceFailure>;
  archiveFood(userId: string, id: string): Promise<boolean>;
  createRecipe(userId: string, input: RecipeInput): Promise<Recipe>;
  updateRecipe(userId: string, id: string, patch: RecipePatch): Promise<Recipe | null>;
  archiveRecipe(userId: string, id: string): Promise<boolean>;
  /** The Library recipe page (DECISIONS #47): the recipe, how it reads, and its share link. */
  recipe(userId: string, id: string): Promise<RecipeDetail | null>;
  /** A live, revocable public link (DECISIONS #48) — the active one, or a new one. */
  shareRecipe(userId: string, id: string): Promise<RecipeShare | ServiceFailure>;
  unshareRecipe(userId: string, id: string): Promise<boolean>;
  createMeal(userId: string, input: MealInput): Promise<Meal>;
  updateMeal(userId: string, id: string, patch: MealPatch): Promise<Meal | null>;
  archiveMeal(userId: string, id: string): Promise<boolean>;
  listLog(userId: string, from: IsoDate, to: IsoDate): Promise<FoodLogEntry[]>;
  log(userId: string, entries: FoodLogInput[]): Promise<FoodLogEntry[] | ServiceFailure>;
  patchEntry(userId: string, id: string, patch: FoodLogPatch): Promise<FoodLogEntry | ServiceFailure>;
  deleteEntry(userId: string, id: string): Promise<boolean>;
  copyEntry(userId: string, id: string, to: { date: IsoDate; slot?: string | undefined }): Promise<FoodLogEntry | ServiceFailure>;
  saveSettings(userId: string, settings: FoodSettings): Promise<FoodSettings>;
  /** Staples: Canadian Nutrient File, then USDA (reference data; saving makes it one of the user's foods). */
  searchStaples(q: string, source: StapleSource): Promise<StapleSearchPayload>;
  stapleDetail(source: StapleSource, ref: string): Promise<StapleDetail | ServiceFailure>;
  /** Read a label / screenshot with the small model; the result is reviewed before saving. */
  readPhoto(userId: string, input: PhotoReadInput): Promise<PhotoReadResult | ServiceFailure>;
  /** One of the user's foods for a barcode, else an Open Food Facts product to review. */
  barcode(userId: string, code: string): Promise<BarcodeLookup | ServiceFailure>;
  /** "Log with words": a draft to confirm, matched to the user's foods. Nothing is logged. */
  parse(userId: string, input: FoodParseInput): Promise<FoodParseResult | ServiceFailure>;
  /** Signed links to a food's stored photos. */
  imageUrls(userId: string, foodId: string): Promise<{ key: string; kind: string; url: string }[] | ServiceFailure>;
}

/** BMR and body scans (Athlete page). */
export interface EnergyServices {
  get(userId: string): Promise<EnergyPayload>;
  patch(userId: string, patch: EnergyPatch): Promise<EnergyPayload>;
  addScan(userId: string, input: BodyScanInput): Promise<BodyScan>;
  updateScan(userId: string, id: string, patch: BodyScanPatch): Promise<BodyScan | null>;
  deleteScan(userId: string, id: string): Promise<boolean>;
  /** The day's calorie budget (RMR + activity + exercise + goal). */
  budget(userId: string, date: IsoDate): Promise<EnergyBudget>;
  /** The calendar's food layer: eaten vs budget per day, trend weight per week. */
  days(userId: string, from: IsoDate, to: IsoDate): Promise<DaysPayload>;
}

/** What the auth guard in `app.ts` has put on the context. */
type Vars = { Variables: { user: { id: string } | null } };

const isFailure = (r: object): r is ServiceFailure => 'error' in r && 'status' in r;
const notFound = { error: 'Not found' } as const;

/** `/api/food/*` — mounted behind the auth guard. Chained, so the typed client sees every route. */
export function foodRoutes(food: FoodServices) {
  return (
    new Hono<Vars>()
      .get('/library', async (c) => c.json(await food.library(c.get('user')!.id)))

      // ── Foods ───────────────────────────────────────────────────────────
      .post('/foods', json(foodInputSchema), async (c) => {
        const r = await food.createFood(c.get('user')!.id, c.req.valid('json'));
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r, 201);
      })
      .patch('/foods/:id', json(foodPatchSchema), async (c) => {
        const r = await food.updateFood(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
      })
      .delete('/foods/:id', async (c) =>
        (await food.archiveFood(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json(notFound, 404),
      )
      .get('/foods/:id/images', async (c) => {
        const r = await food.imageUrls(c.get('user')!.id, c.req.param('id'));
        return Array.isArray(r) ? c.json(r) : c.json({ error: r.error }, r.status);
      })

      // ── From the outside world: photos and barcodes ─────────────────────
      .post(
        '/photo',
        bodyLimit({ maxSize: 15 * 1024 * 1024, onError: (c) => c.json({ error: 'Those photos are too large.' }, 413) }),
        json(photoReadInputSchema),
        async (c) => {
          const r = await food.readPhoto(c.get('user')!.id, c.req.valid('json'));
          return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
        },
      )
      .post('/parse', json(foodParseInputSchema), async (c) => {
        const r = await food.parse(c.get('user')!.id, c.req.valid('json'));
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
      })
      .get('/barcode/:code', async (c) => {
        const r = await food.barcode(c.get('user')!.id, c.req.param('code'));
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
      })

      // ── Recipes & meals ─────────────────────────────────────────────────
      .post('/recipes', json(recipeInputSchema), async (c) => c.json(await food.createRecipe(c.get('user')!.id, c.req.valid('json')), 201))
      .get('/recipes/:id', async (c) => {
        const r = await food.recipe(c.get('user')!.id, c.req.param('id'));
        return r ? c.json(r) : c.json(notFound, 404);
      })
      .post('/recipes/:id/share', async (c) => {
        const r = await food.shareRecipe(c.get('user')!.id, c.req.param('id'));
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
      })
      .delete('/recipes/:id/share', async (c) =>
        (await food.unshareRecipe(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json(notFound, 404),
      )
      .patch('/recipes/:id', json(recipePatchSchema), async (c) => {
        const r = await food.updateRecipe(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
        return r ? c.json(r) : c.json(notFound, 404);
      })
      .delete('/recipes/:id', async (c) =>
        (await food.archiveRecipe(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json(notFound, 404),
      )
      .post('/meals', json(mealInputSchema), async (c) => c.json(await food.createMeal(c.get('user')!.id, c.req.valid('json')), 201))
      .patch('/meals/:id', json(mealPatchSchema), async (c) => {
        const m = await food.updateMeal(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
        return m ? c.json(m) : c.json(notFound, 404);
      })
      .delete('/meals/:id', async (c) =>
        (await food.archiveMeal(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json(notFound, 404),
      )

      // ── The log ─────────────────────────────────────────────────────────
      .get('/log', query(foodLogRangeQuerySchema), async (c) => {
        const { from, to } = c.req.valid('query');
        return c.json<FoodLogPayload>({ entries: await food.listLog(c.get('user')!.id, from, to) });
      })
      .post('/log', json(foodLogBulkSchema), async (c) => {
        const r = await food.log(c.get('user')!.id, c.req.valid('json').entries);
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json<FoodLogPayload>({ entries: r }, 201);
      })
      .patch('/log/:id', json(foodLogPatchSchema), async (c) => {
        const r = await food.patchEntry(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
      })
      .delete('/log/:id', async (c) =>
        (await food.deleteEntry(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json(notFound, 404),
      )
      .post('/log/:id/copy', json(foodLogCopySchema), async (c) => {
        const r = await food.copyEntry(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r, 201);
      })

      // ── Staples ─────────────────────────────────────────────────────────
      .get('/staples', query(stapleQuerySchema), async (c) => {
        const { q, source } = c.req.valid('query');
        return c.json(await food.searchStaples(q, source));
      })
      .get('/staples/:source/:ref', async (c) => {
        const source = c.req.param('source');
        if (!(stapleSources as readonly string[]).includes(source)) return c.json(notFound, 404);
        const r = await food.stapleDetail(source as StapleSource, c.req.param('ref'));
        return isFailure(r) ? c.json({ error: r.error }, r.status) : c.json(r);
      })

      .put('/settings', json(foodSettingsSchema), async (c) => c.json(await food.saveSettings(c.get('user')!.id, c.req.valid('json'))))
  );
}

/** `/api/energy/*` — BMR and body scans. */
export function energyRoutes(energy: EnergyServices) {
  return new Hono<Vars>()
    .get('/', async (c) => c.json(await energy.get(c.get('user')!.id)))
    .get('/budget', query(budgetQuerySchema), async (c) => c.json(await energy.budget(c.get('user')!.id, c.req.valid('query').date)))
    .get('/days', query(daysQuerySchema), async (c) => {
      const { from, to } = c.req.valid('query');
      return c.json(await energy.days(c.get('user')!.id, from, to));
    })
    .patch('/', json(energyPatchSchema), async (c) => c.json(await energy.patch(c.get('user')!.id, c.req.valid('json'))))
    .post('/scans', json(bodyScanInputSchema), async (c) => c.json(await energy.addScan(c.get('user')!.id, c.req.valid('json')), 201))
    .patch('/scans/:id', json(bodyScanPatchSchema), async (c) => {
      const s = await energy.updateScan(c.get('user')!.id, c.req.param('id'), c.req.valid('json'));
      return s ? c.json(s) : c.json(notFound, 404);
    })
    .delete('/scans/:id', async (c) =>
      (await energy.deleteScan(c.get('user')!.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json(notFound, 404),
    );
}
