import type { EventsStatus } from '@cycling-coach/shared';
import { DownloadIcon } from '../../components/icons';
import { agoLabel, timeLabel, whenLabel } from '../../lib/events';
import { errorMessage, useExtendEvents, useRefreshEvents } from '../../lib/queries';

/** "Public feed · 512 cycling events through Sat 9:00 PM · synced 4 min ago". */
export function StatusLine({ status, timeZone, now, compact }: { status: EventsStatus | undefined; timeZone: string; now: Date; compact?: boolean }) {
  const refresh = useRefreshEvents();
  if (!status) return <span className="text-[13px] text-muted">Loading events…</span>;
  const running = status.extended?.state === 'running';
  const failed = Boolean(status.lastError);
  const dot = failed ? '#B54708' : status.count ? '#15803D' : '#A3AAB6';
  const source = status.source === 'extended' ? (compact ? 'Extended' : 'Public + extended') : 'Public feed';
  const parts: string[] = [];
  if (running) parts.push(`Getting more events… page ${status.extended!.pages} · ${status.extended!.events} events`);
  else if (failed && status.lastPublicSyncAt) parts.push(`Events unavailable — showing last sync from ${timeLabel(status.lastPublicSyncAt, timeZone)}`);
  else if (!status.count) parts.push(status.lastPublicSyncAt ? 'No upcoming events stored' : 'No events synced yet — the public feed syncs every hour');
  else {
    parts.push(source);
    if (!compact) parts.push(`${status.count.toLocaleString('en-US')} cycling events`);
    if (status.through) parts.push(`through ${whenLabel(status.through, timeZone, now)}`);
    parts.push(compact ? agoLabel(status.lastPublicSyncAt, now) : `synced ${agoLabel(status.lastPublicSyncAt, now)}`);
  }
  const canRefresh = !running && !refresh.isPending && !(status.refreshAllowedAt && Date.parse(status.refreshAllowedAt) > now.getTime());
  const error = refresh.error ?? (status.extended?.state === 'error' ? status.extended.error : undefined);
  return (
    <span className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted ${compact ? 'text-xs' : 'text-[13px]'}`}>
      <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
      <span>{parts.join(' · ')}</span>
      {!compact && (
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={!canRefresh}
          title={canRefresh ? 'Re-read the public feed now' : status.refreshAllowedAt ? `Synced recently — again from ${timeLabel(status.refreshAllowedAt, timeZone)}` : undefined}
          className="border-0 bg-transparent p-0 text-[13px] font-semibold text-accent-ink"
        >
          {refresh.isPending ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
      {error && <span className="text-danger">{typeof error === 'string' ? `Get more events failed: ${error}` : errorMessage(error)}</span>}
    </span>
  );
}

/**
 * "Get more events": the one logged-in walk (~7 days), only when clicked, at most every 6 h — the
 * server refuses sooner. Hidden when the server has no Zwift login.
 */
export function GetMoreButton({ status, timeZone, now, size = 'md' }: { status: EventsStatus | undefined; timeZone: string; now: Date; size?: 'sm' | 'md' | 'lg' }) {
  const extend = useExtendEvents();
  const ext = status?.extended;
  if (!ext) return null;
  const running = ext.state === 'running' || extend.isPending;
  const cooldown = ext.nextAllowedAt && Date.parse(ext.nextAllowedAt) > now.getTime() ? ext.nextAllowedAt : undefined;
  const label = running ? 'Getting events…' : cooldown ? `Again at ${timeLabel(cooldown, timeZone)}` : 'Get more events';
  const sizing = size === 'sm' ? 'min-h-8 px-3 text-xs rounded-full' : size === 'lg' ? 'min-h-11 px-4 rounded-[10px]' : 'min-h-10 px-3.5 rounded-[10px]';
  return (
    <button
      type="button"
      onClick={() => extend.mutate()}
      disabled={running || Boolean(cooldown)}
      title={cooldown ? `Fetched ${agoLabel(ext.finishedAt, now)} — Zwift's logged-in feed is read at most every 6 hours.` : 'Loads about the next 7 days with your Zwift login. Read-only.'}
      className={`flex items-center gap-2 border-0 bg-accent font-semibold text-on-accent ${sizing}`}
    >
      {size !== 'sm' && <DownloadIcon />}
      {size === 'sm' && !running && !cooldown ? 'Get more' : label}
    </button>
  );
}
