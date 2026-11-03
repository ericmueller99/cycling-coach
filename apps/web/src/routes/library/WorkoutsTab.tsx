import { describeMainSet, describeTargets, formatWorkoutDuration, plannedSessionKcal, workoutMetrics } from '@cycling-coach/core';
import type { Workout } from '@cycling-coach/shared';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { MoreIcon } from '../../components/icons';
import { ScheduleControl } from '../../components/ScheduleControl';
import { Sheet } from '../../components/Sheet';
import { Button, Card, ErrorNote, Spinner } from '../../components/ui';
import { ZoneChart } from '../../components/ZoneChart';
import { downloadZwo } from '../../lib/api';
import { errorMessage, useArchiveWorkout, useWorkouts } from '../../lib/queries';
import { SearchBox } from './shared';

const FILTERS = ['All', 'VO2 max', 'Race prep', 'Threshold', 'Endurance'] as const;

export const editPrompt = (w: Workout) => `Let's edit my "${w.name}" workout (id ${w.id}). `;
export const NEW_WORKOUT_PROMPT = 'Build me a new workout: ';

/** "≈ 800 kJ of work" at the current FTP — about the kcal the ride burns (DECISIONS #36). */
const fuelLine = (w: Workout, ftp: number | undefined) =>
  ftp
    ? `≈ ${plannedSessionKcal({ type: 'intervals', segments: w.segments }, ftp).toLocaleString('en-US')} kJ of work at FTP ${ftp} W ≈ kcal burned`
    : 'Targets are % of FTP until yours is set';

function WorkoutCard({ workout, ftp, today }: { workout: Workout; ftp: number | undefined; today: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { totalSec } = workoutMetrics(workout.segments);
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold">{workout.name}</div>
          <div className="text-xs text-muted">{[workout.category, workout.inZwift ? 'In Zwift' : '', workout.source === 'coach' ? 'By coach' : ''].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="font-mono text-[13px] text-muted">{formatWorkoutDuration(totalSec)}</div>
      </div>
      <ZoneChart segments={workout.segments} height={64} />
      <div className="text-[13px]">{describeMainSet(workout.segments)}</div>
      <div className="font-mono text-xs text-muted">{describeTargets(workout.segments, ftp)}</div>
      <div className="text-xs text-muted">{fuelLine(workout, ftp)}</div>
      <div className="flex flex-wrap gap-2">
        <ScheduleControl workout={workout} today={today} />
        <Button size="sm" variant="ghost" onClick={() => downloadZwo(workout.id).catch((e) => setError(errorMessage(e)))}>
          .zwo
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void navigate({ to: '/', search: { new: true, prompt: editPrompt(workout) } })}>
          Edit with coach
        </Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}

/** ⋯ on a phone row: the actions that don't fit. */
function MoreSheet({ workout, onClose }: { workout: Workout; onClose: () => void }) {
  const navigate = useNavigate();
  const archive = useArchiveWorkout();
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet title={workout.name} eyebrow={workout.category} onClose={onClose}>
      <Button size="lg" variant="ghost" onClick={() => void navigate({ to: '/', search: { new: true, prompt: editPrompt(workout) } })}>
        Edit with coach
      </Button>
      {confirm ? (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] text-muted">Removes it from your library. Sessions already on the calendar keep it.</div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button size="lg" variant="primary" style={{ background: '#B42318', color: '#FFFFFF' }} disabled={archive.isPending} onClick={() => archive.mutate(workout.id, { onSuccess: onClose })}>
              {archive.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="lg" variant="danger" onClick={() => setConfirm(true)}>
          Delete…
        </Button>
      )}
      {archive.error && <ErrorNote>{errorMessage(archive.error)}</ErrorNote>}
    </Sheet>
  );
}

function MobileWorkoutCard({ workout, ftp, today }: { workout: Workout; ftp: number | undefined; today: string }) {
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const { totalSec } = workoutMetrics(workout.segments);
  return (
    <Card className="flex flex-col gap-2.5 p-3.5">
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="m-0 text-[16px]">{workout.name}</h2>
          <div className="text-xs text-muted">{[workout.category, workout.inZwift ? 'In Zwift' : '', workout.source === 'coach' ? 'By coach' : ''].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="font-mono text-[16px] font-semibold whitespace-nowrap">
          {Math.round(totalSec / 60)}
          <span className="text-[11px] text-muted"> min</span>
        </div>
      </div>
      <ZoneChart segments={workout.segments} height={56} />
      <div className="text-[13px]">{describeMainSet(workout.segments)}</div>
      <div className="text-xs text-muted">{fuelLine(workout, ftp)}</div>
      <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>span:has(input)]:basis-full">
        <ScheduleControl workout={workout} today={today} />
        <Button size="sm" variant="ghost" onClick={() => downloadZwo(workout.id).catch((e) => setError(errorMessage(e)))}>
          .zwo
        </Button>
        <button
          type="button"
          aria-label={`More actions for ${workout.name}`}
          onClick={() => setMore(true)}
          className="flex h-[44px] max-w-[44px] min-w-[44px] items-center justify-center rounded-lg border border-line-strong bg-transparent text-ink"
        >
          <MoreIcon />
        </button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {more && <MoreSheet workout={workout} onClose={() => setMore(false)} />}
    </Card>
  );
}

/** Library › Workouts: the Zwift workouts, filterable, with a fuel line. */
export function WorkoutsTab({ mobile, today, ftp }: { mobile: boolean; today: string; ftp: number | undefined }) {
  const workouts = useWorkouts();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () =>
      (workouts.data ?? []).filter(
        (w) => (filter === 'All' || w.category === filter) && (!query || `${w.name} ${w.description ?? ''}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [workouts.data, filter, query],
  );
  if (workouts.isPending) return <Spinner />;
  if (workouts.error) return <ErrorNote>{errorMessage(workouts.error)}</ErrorNote>;
  return (
    <div className="flex flex-col gap-4 mobile:gap-3">
      <SearchBox value={query} onChange={setQuery} placeholder="Search workouts" />
      <div className="flex scrollbar-none gap-2 overflow-x-auto">
        {FILTERS.map((f) => {
          const n = f === 'All' ? workouts.data.length : workouts.data.filter((w) => w.category === f).length;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-9 shrink-0 rounded-full border px-3 text-[13px] whitespace-nowrap mobile:min-h-[36px] ${filter === f ? 'border-ink bg-ink font-semibold text-white' : 'border-line-strong bg-surface text-ink'}`}
            >
              {f} <span className="font-mono text-xs opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      {visible.length ? (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))' }}>
          {visible.map((w) => (mobile ? <MobileWorkoutCard key={w.id} workout={w} ftp={ftp} today={today} /> : <WorkoutCard key={w.id} workout={w} ftp={ftp} today={today} />))}
        </div>
      ) : (
        <div className="rounded-[14px] border border-dashed border-line-strong bg-surface p-6 text-center text-[13px] text-muted">
          {query ? `No workout matches “${query}”.` : 'No workouts in this category yet. Ask the coach to build one.'}
        </div>
      )}
    </div>
  );
}
