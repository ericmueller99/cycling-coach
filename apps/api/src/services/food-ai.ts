import { randomUUID } from 'node:crypto';
import type { CallUsage, FoodAi } from '@cycling-coach/coach';
import { buildCatalog, formatLongDay, normalizeBarcode, resolveWords } from '@cycling-coach/core';
import { findFoodByBarcode, getFood, recordAiCall, type Collections } from '@cycling-coach/db';
import type { BarcodeLookup, FoodImageRef, FoodLibrary, FoodParseInput, FoodParseResult, PhotoReadInput, PhotoReadResult } from '@cycling-coach/shared';
import type { ServiceFailure as Failure } from '../app';
import { OpenFoodFactsError, type OpenFoodFacts } from '../providers/openfoodfacts';
import { userImagePrefix, type PhotoStore } from '../providers/storage/s3';
import { allowSpend, type SpendDecision, type SpendGuard } from '../lib/spend';

/** The spend guard said no: a 402 with what to show. */
const refusal = (d: Extract<SpendDecision, { allow: false }>): Failure => ({
  error: d.message,
  status: 402,
  ...(d.action ? { action: d.action } : {}),
});

const aiOff: Failure = { error: 'Reading photos needs CLAUDE_API_KEY on the server. Enter the food by hand instead.', status: 503 };
/** ~5 MB decoded per image is far above a 1600 px JPEG; anything bigger wasn't shrunk. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Adding foods from the outside world : a photo read by the small model, or a
 * barcode looked up in the user's foods and then Open Food Facts. Everything returned here is a
 * proposal — the food form saves it only after the user has checked it.
 */
export class FoodAiService {
  constructor(
    private readonly c: Collections,
    private readonly ai: FoodAi | null,
    private readonly photos: PhotoStore | null,
    private readonly off: OpenFoodFacts,
    private readonly library: (userId: string) => Promise<FoodLibrary>,
    private readonly timezone: (userId: string) => Promise<string>,
    private readonly now: () => Date = () => new Date(),
    /** Asked before every model call; a message refuses it (hosted quotas, DECISIONS #57). */
    private readonly spendGuard: SpendGuard = allowSpend,
  ) {}

  /**
   * "Bagel and butter for breakfast" → a draft to confirm. The model sees only
   * the user's catalog; `core.resolveWords` checks every id and fills in usual portions. Refining sends
   * the current list back with the change. Nothing is logged here.
   */
  async parse(userId: string, input: FoodParseInput): Promise<FoodParseResult | Failure> {
    if (!this.ai) return { error: 'Logging with words needs CLAUDE_API_KEY on the server. Use Log food instead.', status: 503 };
    const decision = await this.spendGuard(userId, 'food_parse');
    if (!decision.allow) return refusal(decision);
    const [lib, tz] = await Promise.all([this.library(userId), this.timezone(userId)]);
    const { lines, refs } = buildCatalog(lib);
    const idOf = new Map([...refs].map(([short, ref]) => [`${ref.kind}:${ref.id}`, short]));
    const now = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(this.now());
    const result = await this.ai.parsePhrase({
      phrase: input.phrase,
      catalog: lines,
      slots: lib.settings.slots.map((s) => s.name),
      viewedDay: formatLongDay(input.date),
      now,
      draft: input.draft?.map((d) => ({ ref: d.match ? (idOf.get(`${d.match.kind}:${d.match.id}`) ?? null) : null, heard: d.heard, quantity: d.quantity, unit: d.unit })),
    });
    await this.record(userId, 'food_parse', result.usage);
    if (!result.ok) return { error: result.error, status: 502 };
    return resolveWords(result.value, refs, lib, { viewedDate: input.date, slot: input.slot });
  }

  private async record(userId: string, purpose: 'food_vision' | 'food_parse', u: CallUsage | undefined) {
    if (!u) return;
    await recordAiCall(this.c, {
      userId,
      purpose,
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

  /** Read a label / screenshot, and keep the photos (when S3 is configured) to attach to the food. */
  async readPhoto(userId: string, input: PhotoReadInput): Promise<PhotoReadResult | Failure> {
    if (!this.ai) return aiOff;
    const decision = await this.spendGuard(userId, 'food_vision');
    if (!decision.allow) return refusal(decision);
    const buffers = input.images.map((img) => Buffer.from(img.data, 'base64'));
    if (buffers.some((b) => b.byteLength > MAX_IMAGE_BYTES)) return { error: 'That photo is too large — try again (the app shrinks photos before sending).', status: 413 };
    const result = await this.ai.readNutrition(input);
    await this.record(userId, 'food_vision', result.usage);
    if (!result.ok) return { error: result.error, status: 502 };

    let images: FoodImageRef[] = [];
    if (this.photos && result.value.found) {
      const kind: FoodImageRef['kind'] = result.value.imageType;
      images = await Promise.all(
        buffers.map(async (body, i): Promise<FoodImageRef> => {
          const media = input.images[i]!.mediaType;
          const key = `${userImagePrefix(userId)}${randomUUID()}.${media === 'image/png' ? 'png' : media === 'image/webp' ? 'webp' : 'jpg'}`;
          await this.photos!.put(key, body, media);
          return { key, kind: i === 0 ? kind : 'front' };
        }),
      ).catch((err: Error) => {
        // Keeping the photo is a nice-to-have; the reading is what matters.
        console.warn('food photo upload failed', err.message);
        return [];
      });
    }
    return { reading: result.value, images };
  }

  /** One of the user's foods for this barcode; else Open Food Facts' product to review; else nothing. */
  async barcode(userId: string, raw: string): Promise<BarcodeLookup | Failure> {
    const barcode = normalizeBarcode(raw);
    if (!barcode) return { error: `"${raw}" isn't a barcode.`, status: 400 };
    const food = await findFoodByBarcode(this.c, userId, barcode);
    if (food) return { barcode, food };
    try {
      const product = await this.off.product(barcode);
      return product ? { barcode, openFoodFacts: product } : { barcode };
    } catch (err) {
      return { barcode, offError: err instanceof OpenFoodFactsError ? err.message : 'Open Food Facts is not responding.' };
    }
  }

  /** Short-lived links to a food's photos. */
  async imageUrls(userId: string, foodId: string): Promise<{ key: string; kind: string; url: string }[] | Failure> {
    const food = await getFood(this.c, userId, foodId);
    if (!food) return { error: 'Food not found.', status: 404 };
    if (!this.photos || !food.images.length) return [];
    return Promise.all(food.images.map(async (i) => ({ key: i.key, kind: i.kind, url: await this.photos!.signedUrl(i.key) })));
  }
}
