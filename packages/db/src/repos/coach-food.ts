import type { MealIdeas, RecipeDraftLog } from '@cycling-coach/shared';
import type { ObjectId } from 'mongodb';
import type { Collections, MealIdeasDoc, RecipeDraftDoc } from '../collections';
import { idOf, oid } from './util';

/** Meal ideas and coach recipe drafts (DECISIONS #41). */

export const toMealIdeas = (doc: MealIdeasDoc): MealIdeas => ({
  id: idOf(doc),
  threadId: doc.threadId.toHexString(),
  slot: doc.slot,
  date: doc.date,
  ideas: doc.ideas,
  followUps: doc.followUps,
  picked: doc.picked,
  ...(doc.kcalRange ? { kcalRange: doc.kcalRange } : {}),
  createdAt: doc.createdAt.toISOString(),
});

export async function insertMealIdeas(c: Collections, doc: Omit<MealIdeasDoc, '_id'>): Promise<MealIdeasDoc & { _id: ObjectId }> {
  const res = await c.mealIdeas.insertOne(doc);
  return { ...doc, _id: res.insertedId };
}

export async function getMealIdeas(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  return _id ? c.mealIdeas.findOne({ _id, userId }) : null;
}

export async function markIdeaPicked(c: Collections, userId: string, id: string, index: number) {
  const _id = oid(id);
  if (_id) await c.mealIdeas.updateOne({ _id, userId }, { $addToSet: { picked: index } });
}

/** Ideas after a match fix — the doc holds the fix, not the transcript (rule 2). */
export async function setMealIdeas(c: Collections, userId: string, _id: ObjectId, ideas: MealIdeasDoc['ideas']) {
  return c.mealIdeas.findOneAndUpdate({ _id, userId }, { $set: { ideas } }, { returnDocument: 'after' });
}

export async function listThreadMealIdeas(c: Collections, userId: string, threadId: ObjectId) {
  return c.mealIdeas.find({ userId, threadId }).sort({ createdAt: 1 }).toArray();
}

export async function insertRecipeDraft(c: Collections, doc: Omit<RecipeDraftDoc, '_id'>): Promise<RecipeDraftDoc & { _id: ObjectId }> {
  const res = await c.recipeDrafts.insertOne(doc);
  return { ...doc, _id: res.insertedId };
}

export async function getRecipeDraft(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  return _id ? c.recipeDrafts.findOne({ _id, userId }) : null;
}

export async function listThreadRecipeDrafts(c: Collections, userId: string, threadId: ObjectId) {
  return c.recipeDrafts.find({ userId, threadId }).sort({ createdAt: 1 }).toArray();
}

/** Replace the editable fields (servings, lines). Only while not yet saved — a saved one edits in the Library. */
export async function updateRecipeDraft(
  c: Collections,
  userId: string,
  id: ObjectId,
  set: Partial<Pick<RecipeDraftDoc, 'servings' | 'ingredients'>>,
  now: Date,
) {
  return c.recipeDrafts.findOneAndUpdate({ _id: id, userId, recipeId: { $exists: false } }, { $set: { ...set, updatedAt: now } }, { returnDocument: 'after' });
}

/** Link the saved recipe — only the first save wins, so two clicks can't make two recipes. */
export async function setRecipeDraftSaved(c: Collections, userId: string, id: ObjectId, recipeId: string, ingredients: RecipeDraftDoc['ingredients'], now: Date) {
  const res = await c.recipeDrafts.updateOne({ _id: id, userId, recipeId: { $exists: false } }, { $set: { recipeId, ingredients, updatedAt: now } });
  return res.modifiedCount === 1;
}

export async function addRecipeDraftLog(c: Collections, userId: string, id: ObjectId, log: RecipeDraftLog, now: Date) {
  return c.recipeDrafts.findOneAndUpdate({ _id: id, userId }, { $push: { logged: log }, $set: { updatedAt: now } }, { returnDocument: 'after' });
}
