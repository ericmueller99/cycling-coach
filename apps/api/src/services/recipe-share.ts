import { randomBytes } from 'node:crypto';
import { recipeTotals, recipeView } from '@cycling-coach/core';
import { createShare, getActiveShare, getFoodsByIds, getRecipe, getShareByToken, revokeShares, userFirstName, type Collections, type RecipeShareDoc } from '@cycling-coach/db';
import type { RecipeDetail, RecipeShare, SharedRecipe } from '@cycling-coach/shared';
import type { ServiceFailure as Failure } from '../app';

/**
 * Recipe pages and share links (DECISIONS #47–48). A link is live — it always shows the recipe as
 * it is now — and revocable; sharing again after "Turn off link" makes a new token. The public
 * view carries no ids and nothing about the owner but a first name.
 */

/** Tokens are 24 random bytes in base64url (32 chars); anything else is refused before a lookup. */
export const isShareToken = (t: string) => /^[A-Za-z0-9_-]{32}$/.test(t);

export function shareUrl(appUrl: string, token: string): string {
  return new URL(`/r/${token}`, appUrl.endsWith('/') ? appUrl : `${appUrl}/`).toString();
}

export class RecipeShareService {
  constructor(
    private readonly c: Collections,
    private readonly appUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly newToken: () => string = () => randomBytes(24).toString('base64url'),
  ) {}

  private toShare(doc: RecipeShareDoc): RecipeShare {
    return { token: doc.token, url: shareUrl(this.appUrl, doc.token), createdAt: doc.createdAt.toISOString() };
  }

  private async viewOf(userId: string, recipeId: string) {
    const recipe = await getRecipe(this.c, userId, recipeId);
    if (!recipe) return null;
    const foods = await getFoodsByIds(this.c, userId, recipe.ingredients.map((i) => i.foodId));
    const byId = new Map(foods.map((f) => [f.id, f]));
    const withTotals = { ...recipe, totals: recipeTotals(recipe, byId) };
    return { recipe: withTotals, view: recipeView(withTotals, byId) };
  }

  /** The Library recipe page: the recipe, how it reads, and its link if it has one. */
  async detail(userId: string, recipeId: string): Promise<RecipeDetail | null> {
    const r = await this.viewOf(userId, recipeId);
    if (!r) return null;
    const share = await getActiveShare(this.c, userId, recipeId);
    return { ...r, share: share ? this.toShare(share) : null };
  }

  /** The recipe's link — the active one, or a new one. */
  async share(userId: string, recipeId: string): Promise<RecipeShare | Failure> {
    const recipe = await getRecipe(this.c, userId, recipeId);
    if (!recipe || recipe.archived) return { error: 'Recipe not found.', status: 404 };
    const active = await getActiveShare(this.c, userId, recipeId);
    if (active) return this.toShare(active);
    return this.toShare(await createShare(this.c, userId, recipeId, this.newToken(), this.now()));
  }

  /** "Turn off link". True when there was one. */
  async unshare(userId: string, recipeId: string): Promise<boolean> {
    return (await revokeShares(this.c, userId, recipeId, this.now())) > 0;
  }

  /** What `/r/:token` shows — no sign-in. Unknown → 404; turned off, or the recipe removed → 410. */
  async publicView(token: string): Promise<SharedRecipe | Failure> {
    const gone: Failure = { error: 'This link was turned off.', status: 410 };
    if (!isShareToken(token)) return { error: 'Link not found.', status: 404 };
    const share = await getShareByToken(this.c, token);
    if (!share) return { error: 'Link not found.', status: 404 };
    if (share.revokedAt) return gone;
    const r = await this.viewOf(share.userId, share.recipeId);
    if (!r || r.recipe.archived) return gone;
    return { view: r.view, sharedBy: (await userFirstName(this.c, share.userId)) ?? 'A friend', updatedAt: r.recipe.updatedAt };
  }
}
