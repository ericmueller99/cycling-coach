import type { PowerBest } from '@cycling-coach/shared';
import type { ReactNode } from 'react';
import { TrendDownIcon, TrendUpIcon } from '../../components/icons';

export const PERIODS: { key: PowerBest['period']; label: string }[] = [
  { key: '90d', label: '90 days' },
  { key: 'season', label: 'Season' },
  { key: 'allTime', label: 'All-time' },
];

export const durLabel = (sec: number) => (sec < 60 ? `${sec} s` : `${sec / 60} min`);
export const inputCls = 'min-h-[42px] min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 font-mono text-[15px] text-ink';

export function Tile({ label, title, className = 'bg-surface-2', children }: { label: string; title: string; className?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs text-muted" title={title}>
      {label}
      <div className={`flex min-h-[42px] flex-col justify-center rounded-lg px-2.5 py-2 ${className}`}>{children}</div>
    </div>
  );
}

export function DirectionTile({ change, days }: { change: number | undefined; days: number }) {
  const up = change !== undefined && change > 0;
  const down = change !== undefined && change < 0;
  return (
    <Tile label={`${days}-day change`} title="How much the 7-day trend moved over the range" className={up ? 'bg-[#FFF4E5]' : down ? 'bg-[#ECFDF3]' : 'bg-surface-2'}>
      <span className={`flex items-center gap-1.5 font-mono text-base font-semibold ${up ? 'text-[#B54708]' : down ? 'text-success' : 'text-ink'}`}>
        {up && <TrendUpIcon />}
        {down && <TrendDownIcon />}
        {change === undefined ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)} kg`}
      </span>
      <span className="text-xs text-muted">{change === undefined ? 'not enough weigh-ins' : up ? 'Trending up' : down ? 'Trending down' : 'Holding steady'}</span>
    </Tile>
  );
}
