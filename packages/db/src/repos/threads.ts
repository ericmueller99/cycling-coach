import type { Proposal, ProposalItemStatus, ThreadSummary, ThreadTag } from '@cycling-coach/shared';
import type { ObjectId } from 'mongodb';
import type { AiCallDoc, Collections, MessageDoc, ProposalDoc, ThreadDoc } from '../collections';
import { idOf, oid } from './util';

export const toThreadSummary = (doc: ThreadDoc): ThreadSummary => ({
  id: idOf(doc),
  title: doc.title,
  createdAt: doc.createdAt.toISOString(),
  lastMessageAt: doc.lastMessageAt.toISOString(),
  tags: doc.tags ?? [],
});

export async function listThreads(c: Collections, userId: string, limit = 50): Promise<ThreadSummary[]> {
  const docs = await c.threads.find({ userId }).sort({ lastMessageAt: -1 }).limit(limit).toArray();
  return docs.map(toThreadSummary);
}

export async function getThread(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  if (!_id) return null;
  return c.threads.findOne({ _id, userId });
}

export async function createThread(
  c: Collections,
  userId: string,
  systemSnapshot: string[],
  now: Date,
): Promise<ThreadDoc & { _id: ObjectId }> {
  const doc: ThreadDoc = {
    userId,
    title: 'New chat',
    createdAt: now,
    lastMessageAt: now,
    systemSnapshot,
    seen: { athlete: systemSnapshot[1] ?? '' },
  };
  const res = await c.threads.insertOne(doc);
  return { ...doc, _id: res.insertedId };
}

export async function updateThread(
  c: Collections,
  threadId: ObjectId,
  set: Partial<Pick<ThreadDoc, 'title' | 'lastMessageAt' | 'seen' | 'lastBuildStartedAt' | 'buildFollowUpUsed' | 'buildPending'>>,
) {
  await c.threads.updateOne({ _id: threadId }, { $set: set });
}

/** Tag a thread (idempotent). */
export async function addThreadTag(c: Collections, threadId: ObjectId, tag: ThreadTag) {
  await c.threads.updateOne({ _id: threadId }, { $addToSet: { tags: tag } });
}

export async function listMessages(c: Collections, threadId: ObjectId) {
  return c.messages.find({ threadId }).sort({ seq: 1 }).toArray();
}

/**
 * Append-only. Messages are never updated or deleted once written: the model's thinking blocks are
 * only valid when replayed exactly as produced (docs/DECISIONS.md #6).
 */
export async function appendMessage(
  c: Collections,
  doc: Omit<MessageDoc, '_id' | 'seq'>,
): Promise<MessageDoc> {
  const last = await c.messages.find({ threadId: doc.threadId }).sort({ seq: -1 }).limit(1).next();
  const full: MessageDoc = { ...doc, seq: (last?.seq ?? -1) + 1 };
  const res = await c.messages.insertOne(full);
  return { ...full, _id: res.insertedId };
}

export const toProposal = (doc: ProposalDoc): Proposal => {
  const base = { id: idOf(doc), threadId: doc.threadId.toHexString(), title: doc.title, itemStatus: doc.itemStatus };
  switch (doc.kind) {
    case 'plan':
      return { ...base, kind: 'plan', items: doc.items, ...(doc.subtitle ? { subtitle: doc.subtitle } : {}) };
    case 'calendar_changes':
      return { ...base, kind: 'calendar_changes', items: doc.items, ...(doc.before ? { before: doc.before } : {}) };
    case 'profile_update':
      return { ...base, kind: 'profile_update', items: doc.items };
    case 'goal':
      return { ...base, kind: 'goal', items: doc.items };
  }
};

export async function createProposal(c: Collections, doc: Omit<ProposalDoc, '_id'>) {
  const res = await c.proposals.insertOne(doc as ProposalDoc);
  return toProposal({ ...doc, _id: res.insertedId } as ProposalDoc);
}

export async function getProposalDoc(c: Collections, userId: string, id: string) {
  const _id = oid(id);
  if (!_id) return null;
  return c.proposals.findOne({ _id, userId });
}

export async function listProposals(c: Collections, userId: string, threadId: ObjectId) {
  return (await c.proposals.find({ userId, threadId }).toArray()).map(toProposal);
}

export async function setProposalItemStatus(
  c: Collections,
  proposalId: ObjectId,
  index: number,
  status: ProposalItemStatus,
) {
  await c.proposals.updateOne({ _id: proposalId }, { $set: { [`itemStatus.${index}`]: status } });
}

export async function recordAiCall(c: Collections, doc: Omit<AiCallDoc, '_id'>) {
  await c.aiCalls.insertOne(doc);
}

export async function aiSpendSince(c: Collections, userId: string, since: Date) {
  const [row] = await c.aiCalls
    .aggregate<{ costUsd: number; calls: number }>([
      { $match: { userId, createdAt: { $gte: since } } },
      { $group: { _id: null, costUsd: { $sum: '$costUsd' }, calls: { $sum: 1 } } },
    ])
    .toArray();
  return { costUsd: row?.costUsd ?? 0, calls: row?.calls ?? 0 };
}

/** Spend per tier in `[from, to)`. Calls with no tier predate routing and count as `other`. */
export async function aiSpendByTier(c: Collections, userId: string, from: Date, to?: Date) {
  const rows = await c.aiCalls
    .aggregate<{ _id: 'chat' | 'build' | null; costUsd: number }>([
      { $match: { userId, createdAt: { $gte: from, ...(to ? { $lt: to } : {}) } } },
      { $group: { _id: '$tier', costUsd: { $sum: '$costUsd' } } },
    ])
    .toArray();
  const of = (tier: 'chat' | 'build' | null) => rows.find((r) => (r._id ?? null) === tier)?.costUsd ?? 0;
  return { chatUsd: of('chat'), buildUsd: of('build'), otherUsd: of(null) };
}
