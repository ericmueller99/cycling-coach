import type { FullSyncProgress } from '@cycling-coach/shared';
import { useState } from 'react';
import { PulseIcon } from '../../components/icons';
import { Button, Card, ErrorNote } from '../../components/ui';
import { useExtensions } from '../../extensions';
import { errorMessage, useIntervals, useIntervalsFullSync, useIntervalsSync, useMe, useZwift, useZwiftSync } from '../../lib/queries';

function timeAgo(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/**
 * A full import's overall share done, 0–1. Listing rides and wellness is quick; fetching each ride's
 * intervals (one a second) is most of the time, so it gets most of the bar.
 */
export function fullSyncFraction(p: FullSyncProgress): number {
  const share = (done: number, total: number) => (total > 0 ? Math.min(1, done / total) : 0);
  switch (p.phase) {
    case 'activities':
      return 0.08 * (1 - 1 / (1 + p.done / 8));
    case 'wellness':
      return 0.08 + 0.04 * share(p.done, p.total);
    case 'details':
      return 0.12 + 0.86 * share(p.done, p.total);
    case 'match':
      return 0.98;
  }
}

function fullSyncLine(p: FullSyncProgress): string {
  switch (p.phase) {
    case 'activities':
      return `Finding rides${p.label ? ` · ${p.label}` : ''} · ${p.rides.toLocaleString()} so far`;
    case 'wellness':
      return `Weight, steps & fitness${p.label ? ` · ${p.label}` : ''}`;
    case 'details': {
      const left = Math.max(0, p.total - p.done);
      const minutes = Math.ceil(left / 60);
      return `Ride details ${p.done.toLocaleString()} / ${p.total.toLocaleString()}${left ? ` · ~${minutes} min left` : ''}`;
    }
    case 'match':
      return 'Matching sessions to rides…';
  }
}

/** The full import's bar: phase, counts and a rough time left. */
export function FullSyncBar({ progress }: { progress: FullSyncProgress }) {
  const pct = Math.round(fullSyncFraction(progress) * 100);
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold">Importing your intervals.icu history</span>
        <span className="text-muted tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="text-xs text-muted">
        {progress.waitingUntil
          ? 'Paused — intervals.icu asked us to slow down. It carries on with the next sync (within 15 min).'
          : `${fullSyncLine(progress)} · paced at one request a second`}
      </div>
    </div>
  );
}

export function ConnectionsSection() {
  const me = useMe();
  const { intervalsConnect, usageCard: UsageCard } = useExtensions();
  const intervals = useIntervals();
  const sync = useIntervalsSync();
  const full = useIntervalsFullSync();
  const [confirming, setConfirming] = useState(false);
  const s = intervals.data;
  const ok = s?.status === 'connected';
  const importing = s?.fullSync?.status === 'running';

  return (
    <Card className="flex flex-col gap-2.5 p-[18px]">
      <h2 className="mt-0 mb-1 text-base">Connections</h2>
      <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-surface-2 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-data-tint text-data">
          <PulseIcon size={18} />
        </div>
        <div className="min-w-0 flex-[1_1_160px]">
          <div className="font-semibold">intervals.icu</div>
          <div className="text-xs text-muted">
            {ok
              ? [
                  s.athleteId,
                  s.zwiftConnected === undefined ? '' : s.zwiftConnected ? 'Zwift linked — workouts sync' : 'Zwift not linked in intervals.icu',
                  s.lastSyncAt ? `synced ${timeAgo(s.lastSyncAt)}` : 'not synced yet',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : s?.status === 'not_configured'
                ? intervalsConnect.hint
                : 'Rides, power curves, fitness · workouts to Zwift'}
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: ok ? '#15803D' : s?.status === 'error' ? '#B54708' : '#5B6472' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: ok ? '#15803D' : s?.status === 'error' ? '#B54708' : '#9CA3AF' }} />
          {ok ? 'Connected' : s?.status === 'error' ? 'Error' : 'Not set up'}
        </span>
        {ok && (
          <Button size="sm" variant="ghost" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
        {s && !ok && intervalsConnect.action}
        {s && s.status !== 'not_configured' && intervalsConnect.manage}
      </div>
      {importing && s.fullSync && <FullSyncBar progress={s.fullSync} />}
      {ok && !importing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          {confirming ? (
            <>
              <span>Re-read all your history from intervals.icu? It runs in the background and can take a while.</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={full.isPending}
                onClick={() => full.mutate(undefined, { onSettled: () => setConfirming(false) })}
              >
                Start full sync
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span>
                {s.fullSync?.status === 'failed'
                  ? 'The last full sync stopped.'
                  : s.lastFullSyncAt
                    ? `Full history imported ${timeAgo(s.lastFullSyncAt)}.`
                    : 'History not imported yet.'}{' '}
                Sync now reads what changed since the last sync.
              </span>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Full sync…
              </Button>
            </>
          )}
        </div>
      )}
      {s?.fullSync?.status === 'failed' && s.fullSync.error && <ErrorNote>Full sync: {s.fullSync.error}</ErrorNote>}
      {s?.lastError && <ErrorNote>intervals.icu: {s.lastError}</ErrorNote>}
      {sync.error && <ErrorNote>{errorMessage(sync.error)}</ErrorNote>}
      {full.error && <ErrorNote>{errorMessage(full.error)}</ErrorNote>}
      {sync.data && (
        <div className="text-xs text-muted">
          Synced: {sync.data.rides} ride{sync.data.rides === 1 ? '' : 's'} new or changed, {sync.data.matched} session{sync.data.matched === 1 ? '' : 's'} ticked
          off, {sync.data.bests} power best{sync.data.bests === 1 ? '' : 's'} updated.
        </div>
      )}

      {/* Only accounts that may use a Zwift login (DECISIONS #54); hand-entered zFTP never needs one. */}
      {me.data?.features.zwiftAccount && <ZwiftConnection />}

      {UsageCard && <UsageCard />}
    </Card>
  );
}

/** Under the Zwift row wherever a Zwift login is used (DECISIONS #52). */
export const ZWIFT_TOS_NOTICE = 'Uses Zwift’s unofficial API: not endorsed by Zwift and may breach its terms. Your account, your risk.';

function ZwiftConnection() {
  const { zwiftConnect } = useExtensions();
  const zwift = useZwift();
  const sync = useZwiftSync();
  const s = zwift.data;
  const configured = s && s.status !== 'not_configured';
  const color = s?.status === 'connected' ? '#15803D' : s?.status === 'error' ? '#B54708' : '#5B6472';

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-surface-2 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-data-tint text-data">
          <PulseIcon size={18} />
        </div>
        <div className="min-w-0 flex-[1_1_160px]">
          <div className="font-semibold">Zwift</div>
          <div className="text-xs text-muted">
            {configured
              ? [s.zwiftId ? `ID ${s.zwiftId}` : '', 'zFTP, zMAP, weight', s.lastSyncAt ? `synced ${timeAgo(s.lastSyncAt)}` : 'not synced yet'].filter(Boolean).join(' · ')
              : s?.status === 'not_configured'
                ? zwiftConnect.hint
                : 'zFTP, zMAP, weight'}
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
          <span className="h-2 w-2 rounded-full" style={{ background: s?.status === 'not_configured' || !s ? '#9CA3AF' : color }} />
          {s?.status === 'connected' ? 'Connected' : s?.status === 'error' ? 'Error' : 'Not set up'}
        </span>
        {configured && (
          <Button size="sm" variant="ghost" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
        {s && s.status !== 'connected' && zwiftConnect.action}
        {s && s.status !== 'not_configured' && zwiftConnect.manage}
      </div>
      <div className="text-xs text-muted">{ZWIFT_TOS_NOTICE}</div>
      {s?.lastError && <ErrorNote>Zwift: {s.lastError}</ErrorNote>}
      {sync.error && <ErrorNote>{errorMessage(sync.error)}</ErrorNote>}
    </>
  );
}
