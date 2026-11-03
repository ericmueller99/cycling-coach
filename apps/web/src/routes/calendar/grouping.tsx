import { sessionState } from '@cycling-coach/core';
import type { CalendarActivity, CalendarEvent } from '@cycling-coach/shared';
import { Button, ErrorNote } from '../../components/ui';
import { errorMessage, useCalendarMutations } from '../../lib/queries';
import { intervalsUrl, rideName, rideTime, ridesMeta } from './shared';

/**
 * Grouping rides into a planned session (DECISIONS #32): a long ride Zwift split into several
 * activities counts as the one session it was. Always the athlete's choice — nothing groups by itself.
 */

const ROW = 'flex min-h-11 items-center gap-2 border-b border-divider px-3 py-1.5 text-[13px] last:border-b-0';

const STATE_WORD = { planned: 'planned', completed: 'done', missed: 'missed', skipped: 'skipped' } as const;

/** On an unplanned ride: "Part of a planned session?" with that day's sessions. */
export function AddToSession({
  activity,
  sessions,
  onAdded,
}: {
  activity: CalendarActivity;
  sessions: readonly CalendarEvent[];
  onAdded?: ((eventId: string) => void) | undefined;
}) {
  const { addRide } = useCalendarMutations();
  const open = sessions.filter((e) => e.status !== 'skipped');
  if (!open.length) return null;
  return (
    <section aria-label="Add to a planned session" className="flex flex-col gap-1.5">
      <div className="text-[13px] font-semibold">Part of a planned session?</div>
      <div className="text-xs text-muted">Add it if this ride was a piece of one — a long ride split into several. Its time and load then count towards that session.</div>
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
        {open.map((e) => (
          <div key={e.id} className={ROW}>
            <span className="min-w-0 flex-auto truncate">
              <strong>{e.title}</strong> <span className="text-muted">· {STATE_WORD[sessionState(e)]}</span>
            </span>
            <Button
              size="sm"
              className="flex-none"
              disabled={addRide.isPending}
              onClick={() => addRide.mutate({ id: e.id, activityId: activity.id }, { onSuccess: () => onAdded?.(e.id) })}
            >
              Add to session
            </Button>
          </div>
        ))}
      </div>
      {addRide.error && <ErrorNote>{errorMessage(addRide.error)}</ErrorNote>}
    </section>
  );
}

/** On a session: the day's unplanned rides, each with Add. */
export function AddRideFromDay({ event, rides, title }: { event: CalendarEvent; rides: readonly CalendarActivity[]; title: string }) {
  const { addRide } = useCalendarMutations();
  if (event.status === 'skipped' || !rides.length) return null;
  return (
    <section aria-label="Add a ride from this day" className="flex flex-col gap-1.5">
      <div className="text-[13px] font-semibold">{title}</div>
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
        {rides.map((a) => (
          <div key={a.id} className={ROW}>
            <span className="flex-none font-mono text-xs text-muted">{rideTime(a)}</span>
            <span className="min-w-0 flex-auto truncate">
              <strong>{rideName(a)}</strong> <span className="text-muted">· {ridesMeta([a])}</span>
            </span>
            <Button size="sm" className="flex-none" disabled={addRide.isPending} onClick={() => addRide.mutate({ id: event.id, activityId: a.id })}>
              Add
            </Button>
          </div>
        ))}
      </div>
      {addRide.error && <ErrorNote>{errorMessage(addRide.error)}</ErrorNote>}
    </section>
  );
}

/** A session ridden in pieces: every ride, each with Remove from session. */
export function SessionRideList({ event, rides }: { event: CalendarEvent; rides: readonly CalendarActivity[] }) {
  const { removeRide } = useCalendarMutations();
  return (
    <section aria-label="Rides" className="flex flex-col gap-1.5">
      <div className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">Rides</div>
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
        {rides.map((a) => (
          <div key={a.id} className={ROW}>
            <span className="flex-none font-mono text-xs text-muted">{rideTime(a)}</span>
            <span className="flex min-w-0 flex-auto flex-col">
              <strong className="truncate">{rideName(a)}</strong>
              <span className="text-xs text-muted">
                {ridesMeta([a])} ·{' '}
                <a href={intervalsUrl(a.id)} target="_blank" rel="noreferrer">
                  view ↗
                </a>
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="flex-none"
              disabled={removeRide.isPending}
              onClick={() => removeRide.mutate({ id: event.id, activityId: a.id })}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      {removeRide.error && <ErrorNote>{errorMessage(removeRide.error)}</ErrorNote>}
    </section>
  );
}
