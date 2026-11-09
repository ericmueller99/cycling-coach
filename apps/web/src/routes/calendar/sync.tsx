import type { CalendarEvent } from '@cycling-coach/shared';
import { CheckIcon } from '../../components/icons';
import { Button } from '../../components/ui';
import { useCalendarMutations, useIntervals } from '../../lib/queries';

/** Whether a session is on intervals.icu: rides aren't, unless intervals.icu holds one. */
export function syncState(e: CalendarEvent): 'synced' | 'failed' | 'pending' | null {
  if (e.kind === 'ride' && !e.intervals) return null;
  if (e.intervals?.error || e.syncError) return 'failed';
  return e.intervals ? 'synced' : 'pending';
}

/** "On intervals.icu", or why not with a retry. Nothing when intervals.icu isn't connected. */
export function SyncRow({ event }: { event: CalendarEvent }) {
  const intervals = useIntervals();
  const { resync } = useCalendarMutations();
  const state = syncState(event);
  if (!state || intervals.data?.status !== 'connected') return null;
  const error = event.intervals?.error ?? event.syncError;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
      {state === 'synced' ? (
        <span className="flex items-center gap-1.5 text-success">
          <CheckIcon /> On intervals.icu
          {event.kind === 'workout' && event.platform !== 'garmin' && intervals.data.zwiftConnected ? ' → Zwift' : ''}
        </span>
      ) : (
        <span className="text-danger">{state === 'failed' ? `Not synced: ${error}` : 'Not synced yet'}</span>
      )}
      {state !== 'synced' && (
        <Button size="sm" variant="ghost" disabled={resync.isPending} onClick={() => resync.mutate(event.id)}>
          {resync.isPending ? 'Syncing…' : 'Retry sync'}
        </Button>
      )}
    </div>
  );
}
