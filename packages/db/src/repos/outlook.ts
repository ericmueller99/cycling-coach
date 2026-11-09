import type { Outlook } from '@cycling-coach/shared';
import type { CoachOutlookDoc, Collections } from '../collections';

/** The coach's outlook (DECISIONS #101): one per athlete, written by the coach or edited by them. */

const toOutlook = (doc: CoachOutlookDoc): Outlook => ({ text: doc.text, updatedAt: doc.updatedAt.toISOString(), source: doc.source });

export async function getOutlook(c: Collections, userId: string): Promise<Outlook | null> {
  const doc = await c.coachOutlook.findOne({ userId });
  return doc ? toOutlook(doc) : null;
}

/** Writes it whole; `previous` is what it said before, for Undo. */
export async function setOutlook(c: Collections, userId: string, text: string, source: Outlook['source'], now: Date): Promise<{ outlook: Outlook; previous: Outlook | null }> {
  const before = await c.coachOutlook.findOneAndUpdate({ userId }, { $set: { text, source, updatedAt: now } }, { upsert: true, returnDocument: 'before' });
  return { outlook: { text, source, updatedAt: now.toISOString() }, previous: before ? toOutlook(before) : null };
}

export async function clearOutlook(c: Collections, userId: string): Promise<boolean> {
  return (await c.coachOutlook.deleteOne({ userId })).deletedCount === 1;
}

/**
 * Undo a rewrite: back to `to` (or none), but only if it still says `from`, so an edit made since is
 * never overwritten. `changed` when it isn't.
 */
export async function revertOutlook(c: Collections, userId: string, from: string, to: string | null, now: Date): Promise<Outlook | null | 'changed'> {
  if (to === null) return (await c.coachOutlook.deleteOne({ userId, text: from })).deletedCount === 1 ? null : 'changed';
  const doc = await c.coachOutlook.findOneAndUpdate({ userId, text: from }, { $set: { text: to, source: 'coach', updatedAt: now } }, { returnDocument: 'after' });
  return doc ? toOutlook(doc) : 'changed';
}
