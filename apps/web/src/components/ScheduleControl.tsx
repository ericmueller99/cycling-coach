import { workoutMetrics } from '@cycling-coach/core';
import type { Workout } from '@cycling-coach/shared';
import { useState } from 'react';
import { errorMessage, useCalendarMutations, useIntervals } from '../lib/queries';
import { sessionTypeFor } from '../lib/session';
import { CheckIcon } from './icons';
import { Button, ErrorNote } from './ui';

/**
 * "Schedule…" for a library workout: pick a date and it becomes a Zwift workout session, which
 * syncs to intervals.icu (and on to Zwift) automatically.
 */
export function ScheduleControl({ workout, today }: { workout: Workout; today: string | undefined }) {
  const intervals = useIntervals();
  const { create } = useCalendarMutations();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const synced = intervals.data?.status === 'connected';
  const totalMin = Math.round(workoutMetrics(workout.segments).totalSec / 60);

  if (create.isSuccess) {
    return (
      <span className="flex min-h-9 items-center gap-1 text-[13px] text-success">
        <CheckIcon /> Scheduled
        {synced && (create.data?.intervals ? ' · on intervals.icu → Zwift' : create.data?.syncError ? ' · sync pending' : '')}
      </span>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Schedule…
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={date}
        min={today}
        onChange={(e) => setDate(e.target.value)}
        className="min-h-9 rounded-lg border border-line-strong px-2 font-mono text-[13px]"
        aria-label={`Date for ${workout.name}`}
      />
      <span className="text-[13px] text-muted">on Zwift</span>
      <Button
        size="sm"
        variant="primary"
        disabled={!date || create.isPending}
        onClick={() =>
          create.mutate({
            date,
            kind: 'workout',
            platform: 'zwift',
            type: sessionTypeFor(workout),
            title: workout.name,
            workoutId: workout.id,
            durationMin: totalMin,
            tentative: false,
          })
        }
      >
        Add
      </Button>
      {create.error && <ErrorNote>{errorMessage(create.error)}</ErrorNote>}
    </span>
  );
}
