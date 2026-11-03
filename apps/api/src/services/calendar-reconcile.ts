import type { CalendarEvent } from '@cycling-coach/shared';
import { ourEventId, type RemoteEvent } from '../providers/intervals-icu/map';

/**
 * What a sync should do, decided from the two calendars alone. Pure, so the conflict rules are
 * tested without a network (docs/DECISIONS.md #16):
 *
 * - intervals.icu is the backend: an edit or delete made there wins…
 * - …except over a local change that hasn't been pushed yet (`intervals.error`). Pushing runs
 *   before reconciling, so a change is only still pending when intervals.icu was unreachable.
 * - Our own creates come back carrying our external_id: adopt them, never import them as new.
 */
export type SyncAction =
  | { type: 'import'; remote: RemoteEvent }
  | { type: 'adopt'; local: CalendarEvent; remote: RemoteEvent }
  | { type: 'update'; local: CalendarEvent; remote: RemoteEvent }
  | { type: 'remove-local'; local: CalendarEvent };

const newer = (a: string | undefined, b: string | undefined) => !!a && (!b || Date.parse(a) > Date.parse(b));

/**
 * @param local sessions in the window that sync (workouts, races, or anything already linked)
 * @param remote intervals.icu workouts and races in the same window
 */
export function reconcile(local: readonly CalendarEvent[], remote: readonly RemoteEvent[]): SyncAction[] {
  const actions: SyncAction[] = [];
  const byEventId = new Map(local.filter((e) => e.intervals).map((e) => [e.intervals!.eventId, e]));
  const byId = new Map(local.map((e) => [e.id, e]));
  const seen = new Set<number>();

  for (const r of remote) {
    seen.add(r.id);
    const linked = byEventId.get(r.id);
    if (linked) {
      if (linked.intervals!.error) continue; // pending local change wins until it's pushed
      if (newer(r.updated, linked.intervals!.remoteUpdated)) actions.push({ type: 'update', local: linked, remote: r });
      continue;
    }
    // One of ours whose create response never arrived: link it instead of importing a copy.
    const ourId = ourEventId(r.externalId);
    const ours = ourId ? byId.get(ourId) : undefined;
    if (ours && !ours.intervals) {
      actions.push({ type: 'adopt', local: ours, remote: r });
      continue;
    }
    if (ours) continue; // ours and already linked to a different event — leave it alone
    if (ourId) continue; // ours, but the session is outside this window or gone — never import a copy
    actions.push({ type: 'import', remote: r });
  }

  for (const e of local) {
    if (!e.intervals || seen.has(e.intervals.eventId)) continue;
    if (e.intervals.error) continue; // never delete something with an unpushed change
    actions.push({ type: 'remove-local', local: e });
  }
  return actions;
}
