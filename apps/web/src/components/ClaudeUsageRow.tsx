import { useUsage } from '../lib/queries';
import { KeyIcon } from './icons';

/** The Claude API row on Connections: model and this month's estimated spend. */
export function ClaudeUsageRow() {
  const usage = useUsage();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-surface-2 p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-hover text-[#4B5563]">
        <KeyIcon />
      </div>
      <div className="min-w-0 flex-[1_1_160px]">
        <div className="font-semibold">Claude API</div>
        <div className="font-mono text-xs text-muted">
          {usage.data ? `${usage.data.model} · $${usage.data.monthToDateUsd.toFixed(2)} this month (est.) · ${usage.data.calls} calls` : '…'}
        </div>
      </div>
    </div>
  );
}
