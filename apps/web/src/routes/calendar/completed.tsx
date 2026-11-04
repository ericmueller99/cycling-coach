import { combineRides, formatLongDay, formatWorkoutDuration, sessionRideIds, workoutMetrics } from '@cycling-coach/core';
import type { CalendarActivity, CalendarEvent, RideTotals, SessionCompliance, SessionFeedback } from '@cycling-coach/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { FeedbackCard } from '../../components/FeedbackCard';
import { DoneIcon, MoreIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { Button, ErrorNote, SectionLabel } from '../../components/ui';
import { ZoneChart } from '../../components/ZoneChart';
import { downloadZwo } from '../../lib/api';
import { COMPLETED } from '../../lib/feedback';
import { errorMessage, useCalendarMutations, useSessionResult, useWorkout } from '../../lib/queries';
import { durationText } from '../../lib/session';
import { AddRideFromDay, SessionRideList } from './grouping';
import { askCoachPrompt, intervalsUrl, PANEL } from './shared';

/** Result banner colours and wording by compliance band. */
const BAND: Record<SessionCompliance['band'], { word: string; bg: string; border: string; fg: string }> = {
  hit: { word: 'Target hit.', ...COMPLETED },
  close: { word: 'Close.', bg: '#FFF8E6', border: '#F3D58A', fg: '#7A4B00' },
  under: { word: 'Under target.', bg: '#FFF1E8', border: '#F6CDB0', fg: '#B54708' },
};

/** 239 → "3:59" */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function StatusPill() {
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full py-0.5 pr-2.5 pl-1.5 text-xs font-bold"
      style={{ background: COMPLETED.bg, border: `1px solid ${COMPLETED.border}`, color: COMPLETED.fg }}
    >
      <DoneIcon size={14} />
      Completed
    </span>
  );
}

function ResultBanner({ c }: { c: SessionCompliance }) {
  const band = BAND[c.band];
  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" style={{ background: band.bg, border: `1px solid ${band.border}`, color: band.fg }}>
      <div className="flex-none font-mono text-[26px] font-semibold">{c.pct}%</div>
      <div className="text-[13px]">
        <strong>{band.word}</strong> {c.repsDone} of {c.repsPlanned} reps at {c.actualWatts} W avg vs {c.plannedWatts} W planned.
      </div>
    </div>
  );
}

/** Planned in muted mono, actual in bold mono, with the planned profile and any extra efforts below. */
function PlannedVsActual({ event, activity, compliance }: { event: CalendarEvent; activity: RideTotals; compliance: SessionCompliance | null }) {
  const workout = useWorkout(event.workoutId ?? '', !!event.workoutId);
  const planned = workout.data ? formatWorkoutDuration(workoutMetrics(workout.data.segments).totalSec) : durationText(event) || '—';
  const rows: { k: string; p: string; a: string }[] = [
    { k: 'Duration', p: planned, a: formatWorkoutDuration(activity.movingSec) },
    ...(compliance
      ? [
          { k: 'Work reps', p: `${compliance.repsPlanned}×${clock(compliance.repSec)}`, a: `${compliance.repsDone}×${clock(compliance.actualRepSec)}` },
          { k: 'Rep power', p: `${compliance.plannedWatts} W`, a: `${compliance.actualWatts} W` },
        ]
      : []),
    {
      k: 'NP / IF',
      p: '—',
      a: [activity.normalizedWatts ? `${activity.normalizedWatts} W` : '', activity.intensityPct ? (activity.intensityPct / 100).toFixed(2) : ''].filter(Boolean).join(' · ') || '—',
    },
    { k: 'Load', p: '—', a: activity.trainingLoad !== undefined ? String(activity.trainingLoad) : '—' },
  ];
  const extras = compliance?.extras.map((x) => `${clock(x.durationSec)} @ ${x.watts} W`).join(', ');
  const grid = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] px-3 py-2';
  return (
    <section aria-label="Planned vs actual" className="shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
      <div className={`${grid} border-b border-divider text-[11px] font-semibold tracking-[0.06em] text-muted uppercase`}>
        <span>Planned vs actual</span>
        <span>Planned</span>
        <span>Actual</span>
      </div>
      {rows.map((r) => (
        <div key={r.k} className={`${grid} items-baseline border-b border-divider text-[13px]`}>
          <span className="text-muted">{r.k}</span>
          <span className="font-mono text-muted">{r.p}</span>
          <span className="font-mono font-semibold">{r.a}</span>
        </div>
      ))}
      {workout.data && (
        <div className="flex flex-col gap-1 px-3 py-2.5">
          <ZoneChart segments={workout.data.segments} height={54} />
          <div className="text-[11px] text-muted">Planned profile{extras ? ` · also ${extras}` : ''}</div>
        </div>
      )}
    </section>
  );
}

/**
 * A completed session: the result against the plan, how it felt,
 * and only the actions that still make sense — no Move, Mark planned or Delete.
 */
export function CompletedPanel({
  event,
  rides,
  dayRides,
  feedback,
  onClose,
  sheet = false,
}: {
  event: CalendarEvent;
  rides: CalendarActivity[];
  dayRides: CalendarActivity[];
  feedback: SessionFeedback | undefined;
  onClose: () => void;
  sheet?: boolean;
}) {
  const navigate = useNavigate();
  const { patch, unlink } = useCalendarMutations();
  const result = useSessionResult(event.id, !!event.activityId);
  const [more, setMore] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activity = result.data?.activity ?? rides[0];
  const totals = result.data?.totals ?? (rides.length ? combineRides(rides) : undefined);
  const rideCount = sessionRideIds(event).length;
  const grouped = rideCount > 1;
  const day = formatLongDay(event.date);

  const matched =
    event.activityId &&
    (grouped ? (
      <div className="text-[13px] text-muted">{rideCount} rides</div>
    ) : (
      <div className="text-[13px] text-muted">
        Matched to <strong className="text-ink">{activity?.name ?? 'a ride'}</strong> ·{' '}
        {activity?.provider ? (
          activity.sourceLabel
        ) : (
          <>
            synced from intervals.icu ·{' '}
            <a href={intervalsUrl(event.activityId)} target="_blank" rel="noreferrer">
              view ↗
            </a>
          </>
        )}
      </div>
    ));
  const askCoach = () => void navigate({ to: '/', search: { new: true, prompt: askCoachPrompt(event.title, event.date, `event ${event.id}`) } });

  const body = (
    <>
      {result.isPending && event.activityId && <div className="text-[13px] text-muted">Reading the ride from intervals.icu…</div>}
      {result.error && <div className="text-[13px] text-muted">Couldn’t read the ride’s intervals: {errorMessage(result.error)}</div>}
      {result.data?.compliance && <ResultBanner c={result.data.compliance} />}
      {totals && <PlannedVsActual event={event} activity={totals} compliance={result.data?.compliance ?? null} />}
      {grouped && <SessionRideList event={event} rides={result.data?.rides ?? rides} />}
      {event.coachNote && (
        <div className="rounded-[10px] border border-accent-line bg-accent-tint-2 p-3 text-[13px] whitespace-pre-wrap">
          <div className="mb-1 text-xs font-semibold text-accent-ink">{event.source === 'coach' ? 'Coach note' : 'Notes'}</div>
          {event.coachNote}
        </div>
      )}
      <FeedbackCard target={{ eventId: event.id }} feedback={feedback} />
      <div className="text-xs text-muted">Your rating goes to the coach with this ride. Ask for a read whenever you like.</div>
      <AddRideFromDay event={event} rides={dayRides} title="Ridden in pieces? Add another ride from this day" />
    </>
  );

  const moreActions: ReactNode = more && (
    <div className="flex flex-col gap-2">
      {event.workoutId && (
        <Button size="lg" variant="ghost" onClick={() => downloadZwo(event.workoutId!).catch((e) => setError(errorMessage(e)))}>
          Download .zwo
        </Button>
      )}
      {event.activityId ? (
        confirmUnlink ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
            <span>
              {grouped
                ? 'Unlink all its rides? The session goes back to planned (or missed, once its day is over) and the rides show on their own again. Your rating stays with the main ride.'
                : 'Unlink this ride? The session goes back to planned (or missed, once its day is over) and won’t be matched to this ride again. Your rating stays with the ride.'}
            </span>
            <span className="flex gap-2">
              <Button size="lg" variant="ghost" className="flex-1" onClick={() => setConfirmUnlink(false)}>
                Keep
              </Button>
              <Button size="lg" variant="danger" className="flex-1" disabled={unlink.isPending} onClick={() => unlink.mutate(event.id)}>
                {unlink.isPending ? 'Unlinking…' : grouped ? 'Unlink rides' : 'Unlink ride'}
              </Button>
            </span>
          </div>
        ) : (
          <Button size="lg" variant="ghost" onClick={() => setConfirmUnlink(true)}>
            {grouped ? 'Unlink all rides' : 'Unlink activity'}
          </Button>
        )
      ) : (
        <Button size="lg" variant="ghost" disabled={patch.isPending} onClick={() => patch.mutate({ id: event.id, patch: { status: 'planned' } })}>
          Mark not done
        </Button>
      )}
    </div>
  );
  const actions = (
    <div className="flex gap-2">
      <Button size="lg" className="flex-auto" onClick={askCoach}>
        Ask coach about this ride
      </Button>
      <Button size="lg" aria-label="More actions" aria-expanded={more} className="w-11 flex-none px-0 mobile:w-[44px]" onClick={() => setMore((m) => !m)}>
        <MoreIcon />
      </Button>
    </div>
  );
  const errors = (error || patch.error || unlink.error) && <ErrorNote>{error ?? errorMessage(patch.error ?? unlink.error)}</ErrorNote>;

  if (sheet) {
    return (
      <Sheet
        tall
        eyebrow={day}
        title={event.title}
        header={
          <div className="mt-1.5 flex flex-col gap-1.5">
            <span>
              <StatusPill />
            </span>
            {matched}
          </div>
        }
        onClose={onClose}
        footer={actions}
      >
        {body}
        {moreActions}
        {errors}
      </Sheet>
    );
  }

  return (
    <aside aria-label="Selected session" className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <StatusPill />
            <SectionLabel>{day}</SectionLabel>
          </div>
          <h2 className="m-0 text-[22px]">{event.title}</h2>
          {matched}
        </div>
        <button type="button" onClick={onClose} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>
      {body}
      <div className="border-t border-line pt-3">{actions}</div>
      {moreActions}
      {errors}
    </aside>
  );
}
