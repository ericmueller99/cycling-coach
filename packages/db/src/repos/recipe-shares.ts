import type { Collections, RecipeShareDoc } from '../collections';
import { oid } from './util';

/** Share links for recipes (DECISIONS #48). One active link per recipe; revoking keeps the row. */

export async function getActiveShare(c: Collections, userId: string, recipeId: string): Promise<RecipeShareDoc | null> {
  return c.recipeShares.findOne({ userId, recipeId, revokedAt: { $exists: false } });
}

export async function createShare(c: Collections, userId: string, recipeId: string, token: string, now: Date): Promise<RecipeShareDoc> {
  const doc: RecipeShareDoc = { userId, recipeId, token, createdAt: now };
  const res = await c.recipeShares.insertOne(doc);
  return { ...doc, _id: res.insertedId };
}

/** Turns off every active link to the recipe. */
export async function revokeShares(c: Collections, userId: string, recipeId: string, now: Date): Promise<number> {
  return (await c.recipeShares.updateMany({ userId, recipeId, revokedAt: { $exists: false } }, { $set: { revokedAt: now } })).modifiedCount;
}

export async function getShareByToken(c: Collections, token: string): Promise<RecipeShareDoc | null> {
  return c.recipeShares.findOne({ token });
}

/** The first word of a user's name, for "Shared by Sam". */
export async function userFirstName(c: Collections, userId: string): Promise<string | null> {
  const _id = oid(userId);
  const u = _id ? await c.users.findOne({ _id }, { projection: { name: 1 } }) : null;
  return u?.name?.trim().split(/\s+/)[0] || null;
}
