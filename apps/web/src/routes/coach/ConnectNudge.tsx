import { Link } from '@tanstack/react-router';
import { ChevronRight, ExternalIcon, PulseIcon } from '../../components/icons';
import { Card } from '../../components/ui';
import { useExtensions } from '../../extensions';
import { nudgeCopy, nudgeFor } from '../../lib/connectNudge';
import { useIntervals } from '../../lib/queries';

/** Whether to ask the athlete to connect intervals.icu on Coach (DECISIONS #92). */
function useNudge() {
  const { useOtherTrainingSource } = useExtensions();
  const status = useIntervals().data?.status;
  return nudgeFor(status, useOtherTrainingSource());
}

const SIGN_UP = 'https://intervals.icu';

/**
 * The Coach right rail's card: why intervals.icu matters, the deployment's Connect action, and a way to sign up.
 * Only beside the chat: once the rail wraps under it, `ConnectNudgeRow` asks instead, where it can be seen.
 */
export function ConnectNudge() {
  const { brand, intervalsConnect } = useExtensions();
  const nudge = useNudge();
  if (!nudge) return null;
  return (
    <Card className="hidden flex-col gap-3 border-accent-line bg-accent-tint p-4 @min-[940px]:flex">
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-data-tint text-data">
          <PulseIcon size={18} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="font-semibold">{nudge.kind === 'reconnect' ? 'Reconnect intervals.icu' : `${brand} works best with intervals.icu`}</div>
          <div className="text-[13px] text-muted">{nudgeCopy(nudge).body}</div>
        </div>
      </div>
      {intervalsConnect.action ? (
        <div className="flex flex-wrap items-center gap-2">{intervalsConnect.action}</div>
      ) : (
        <div className="text-xs text-muted">{intervalsConnect.hint}</div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
        {nudge.kind === 'connect' && (
          <a href={SIGN_UP} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
            No account? Sign up free <ExternalIcon size={13} />
          </a>
        )}
        <Link to="/athlete/$tab" params={{ tab: 'goals' }} hash="connections" className="ml-auto">
          All connections
        </Link>
      </div>
    </Card>
  );
}

/** The same ask as one row leading to Connections: under the Today strip on phones, under the header at mid widths. */
export function ConnectNudgeRow({ className = '' }: { className?: string }) {
  const nudge = useNudge();
  if (!nudge) return null;
  return (
    <Link
      to="/athlete/$tab"
      params={{ tab: 'goals' }}
      hash="connections"
      className={`flex min-h-[44px] items-center gap-2.5 bg-accent-tint px-4 py-2 text-[13px] text-ink no-underline desktop:px-7 ${className}`}
    >
      <PulseIcon size={16} className="flex-none text-data" />
      <span className="min-w-0 flex-auto">{nudgeCopy(nudge).row}</span>
      <ChevronRight size={14} className="flex-none text-muted" />
    </Link>
  );
}
