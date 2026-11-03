import { formatShortDate, trendChange } from '@cycling-coach/core';
import type { Profile } from '@cycling-coach/shared';
import { useState } from 'react';
import { Card } from '../../components/ui';
import { WeightChart, type WeightRange } from '../../components/WeightChart';
import { useEnergy } from '../../lib/foodQueries';
import { useWeightHistory } from '../../lib/queries';
import { useIsMobile } from '../../lib/useIsMobile';
import { DirectionTile, Tile } from './shared';

/** The scale (intervals.icu), the 7-day trend the coach uses, and how it's been moving. */
export function WeightSection({ profile }: { profile: Profile }) {
  const history = useWeightHistory();
  const [days, setDays] = useState<WeightRange>(30);
  const points = history.data?.points ?? [];
  const mobile = useIsMobile();
  const energy = useEnergy();

  if (mobile) {
    // Trend + 14-day change, a bare trend line, the latest weigh-in under it.
    const change = trendChange(points, 14);
    const up = change !== undefined && change > 0;
    const down = change !== undefined && change < 0;
    return (
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="m-0 text-[16px]">Weight</h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[10px] bg-surface-2 p-2.5" title="Median of the last 7 days of weigh-ins">
            <div className="text-xs text-muted">Trend (7-day)</div>
            <div className="font-mono text-[20px] font-semibold text-accent-ink">{profile.weightKg.toFixed(1)}</div>
          </div>
          <div className={`rounded-[10px] p-2.5 ${up ? 'bg-[#FFF4E5]' : down ? 'bg-[#ECFDF3]' : 'bg-surface-2'}`} title="How much the 7-day trend moved in 14 days">
            <div className="text-xs text-muted">14 days</div>
            <div className={`font-mono text-[20px] font-semibold ${up ? 'text-[#B54708]' : down ? 'text-success' : 'text-ink'}`}>
              {change === undefined ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)} kg`}
            </div>
          </div>
        </div>
        <WeightChart points={points} days={30} compact loading={history.isPending} />
        <div className="flex justify-between text-xs text-muted">
          <span>{profile.weightLatest ? `Latest ${profile.weightLatest.kg} kg · ${formatShortDate(profile.weightLatest.date)}` : ''}</span>
          <span>30 days</span>
        </div>
      </Card>
    );
  }

  // Trend · change over the range · body fat from the newest scan.
  const scan = energy.data?.scans[0];
  return (
    <Card className="flex flex-col gap-4 p-[18px]">
      <div>
        <h2 className="m-0 text-base">Weight</h2>
        <div className="text-xs text-muted">
          From intervals.icu (your scale)
          {profile.weightLatest ? ` · latest ${profile.weightLatest.kg} kg, ${formatShortDate(profile.weightLatest.date)}` : ''}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Trend (7-day median, kg)" title="Median of the last 7 days of weigh-ins">
          <span className="font-mono text-base font-semibold text-accent-ink">{profile.weightKg.toFixed(1)}</span>
          <span className="text-xs text-muted">used for coaching W/kg</span>
        </Tile>
        <DirectionTile change={trendChange(points, days)} days={days} />
        {scan ? (
          <Tile label={`Body fat (scan, ${formatShortDate(scan.date)})`} title="From your newest body-composition scan">
            <span className="font-mono text-base font-semibold text-ink">{scan.bodyFatPct}%</span>
            <span className="text-xs text-muted">at {scan.weightKg} kg</span>
          </Tile>
        ) : (
          <Tile label="Latest weigh-in" title="Your latest weigh-in on intervals.icu">
            <span className="font-mono text-base font-semibold text-ink">{profile.weightLatest?.kg ?? profile.weightKg}</span>
            {profile.weightLatest && <span className="font-mono text-xs text-muted">{formatShortDate(profile.weightLatest.date)}</span>}
          </Tile>
        )}
      </div>
      <WeightChart points={points} days={days} onDaysChange={setDays} loading={history.isPending} />
      <div className="text-xs text-muted">The trend is the median of the last 7 days of weigh-ins, so one-off swings don't move it.</div>
    </Card>
  );
}
