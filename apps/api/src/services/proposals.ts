import type { NewProposal } from '@cycling-coach/coach';
import {
  applyProfileUpdate,
  createProposal,
  getEvent,
  getProposalDoc,
  setProposalItemStatus,
  toProposal,
  type Collections,
  type ProposalDoc,
} from '@cycling-coach/db';
import type { GoalProposal, Proposal, ProposalChange } from '@cycling-coach/shared';
import type { ObjectId } from 'mongodb';
import type { CalendarService } from './calendar';
import { addGoal, changeGoal } from './goals';

/**
 * Stores a card the coach proposed. Calendar changes keep a snapshot of each event they touch, so the
 * card can show before → after. A revision (`replaces`) dismisses what's still pending on the card it
 * replaces, so the two versions can't both be applied.
 */
export async function createCoachProposal(c: Collections, userId: string, threadId: ObjectId, p: NewProposal, now: Date) {
  const base = {
    userId,
    threadId,
    toolUseId: p.toolUseId,
    title: p.title,
    ...(p.subtitle ? { subtitle: p.subtitle } : {}),
    itemStatus: p.items.map(() => 'pending' as const),
    createdAt: now,
  };
  const doc: ProposalDoc =
    p.kind === 'calendar_changes'
      ? {
          ...base,
          kind: 'calendar_changes',
          items: p.items,
          before: await Promise.all(p.items.map((ch) => ('eventId' in ch ? getEvent(c, userId, ch.eventId) : null))),
        }
      : p.kind === 'plan'
        ? { ...base, kind: 'plan', items: p.items }
        : p.kind === 'goal'
          ? { ...base, kind: 'goal', items: p.items }
          : { ...base, kind: 'profile_update', items: p.items };
  const proposal = await createProposal(c, doc);
  if (p.replaces) {
    // From any of the athlete's chats: a new chat gets the last one's open cards (DECISIONS #82).
    const old = await getProposalDoc(c, userId, p.replaces);
    if (old) await dismissProposal(c, userId, p.replaces, undefined);
  }
  return proposal;
}

/**
 * The confirm half of confirm-before-write: the coach only ever creates proposals;
 * these run when the user presses Add / Add all / Apply. Calendar items go through the calendar
 * service, so an accepted workout or race syncs to intervals.icu like one the user added themselves.
 */
async function applyCalendarChange(cal: CalendarService, userId: string, change: ProposalChange, proposalId: string) {
  switch (change.op) {
    case 'add':
      await cal.create(userId, change.event, { source: 'coach', proposalId });
      return true;
    case 'move':
      return (await cal.patch(userId, change.eventId, { date: change.toDate })) !== null;
    case 'update':
      return (await cal.patch(userId, change.eventId, change.patch)) !== null;
    case 'remove': {
      const result = await cal.remove(userId, change.eventId);
      return result !== null && !('error' in result);
    }
    case 'time_off_add':
      await cal.addTimeOff(userId, change.entry, { source: 'coach', proposalId });
      return true;
    case 'time_off_update': {
      // The row is the whole entry, so a note it no longer has is gone.
      const result = await cal.patchTimeOff(userId, change.timeOffId, { ...change.entry, ...(change.entry.note ? {} : { unset: ['note'] as const }) });
      return result !== null && !('error' in result);
    }
    case 'time_off_remove':
      return cal.removeTimeOff(userId, change.timeOffId);
  }
}

/** Through the goals service, so a goal for an event keeps the event's date (DECISIONS #100). */
async function applyGoal(c: Collections, userId: string, g: GoalProposal, now: Date) {
  const { goalId, ...fields } = g;
  const goal = goalId ? await changeGoal(c, userId, goalId, fields) : await addGoal(c, userId, { ...fields, done: false, primary: fields.primary ?? false }, now);
  return !!goal && !('error' in goal);
}

async function applyItem(c: Collections, cal: CalendarService, userId: string, doc: ProposalDoc, index: number, now: Date): Promise<boolean> {
  const id = doc._id!.toHexString();
  switch (doc.kind) {
    case 'plan': {
      const item = doc.items[index];
      if (!item) return false;
      await cal.create(userId, item, { source: 'coach', proposalId: id });
      return true;
    }
    case 'calendar_changes': {
      const change = doc.items[index];
      return change ? applyCalendarChange(cal, userId, change, id) : false;
    }
    case 'profile_update':
      await applyProfileUpdate(c, userId, doc.items[0], now);
      return true;
    case 'goal':
      return applyGoal(c, userId, doc.items[0], now);
  }
}

export async function applyProposal(
  c: Collections,
  cal: CalendarService,
  userId: string,
  proposalId: string,
  indexes: number[] | undefined,
  now: Date,
): Promise<{ proposal: Proposal; failed: number[] } | null> {
  const doc = await getProposalDoc(c, userId, proposalId);
  if (!doc?._id) return null;
  const targets = (indexes ?? doc.itemStatus.map((_, i) => i)).filter((i) => doc.itemStatus[i] === 'pending');
  const failed: number[] = [];
  for (const i of targets) {
    // An event the coach referenced may have been deleted since — report it, don't half-apply.
    if (await applyItem(c, cal, userId, doc, i, now)) await setProposalItemStatus(c, doc._id, i, 'applied');
    else failed.push(i);
  }
  const updated = await getProposalDoc(c, userId, proposalId);
  return updated ? { proposal: toProposal(updated), failed } : null;
}

export async function dismissProposal(c: Collections, userId: string, proposalId: string, indexes: number[] | undefined) {
  const doc = await getProposalDoc(c, userId, proposalId);
  if (!doc?._id) return null;
  const targets = (indexes ?? doc.itemStatus.map((_, i) => i)).filter((i) => doc.itemStatus[i] === 'pending');
  for (const i of targets) await setProposalItemStatus(c, doc._id, i, 'dismissed');
  const updated = await getProposalDoc(c, userId, proposalId);
  return updated ? toProposal(updated) : null;
}
