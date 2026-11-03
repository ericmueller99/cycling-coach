import { chartBars } from '@cycling-coach/core';
import type { WorkoutSegment } from '@cycling-coach/shared';
import { useMemo } from 'react';

/** Interval-profile bars: flex by minutes, height min(pct,150)/150, zone colour. */
export function ZoneChart({ segments, height = 72 }: { segments: readonly WorkoutSegment[]; height?: number }) {
  const bars = useMemo(() => chartBars(segments), [segments]);
  return (
    <div className="flex items-end gap-px border-b border-line pt-1" style={{ height }} role="img" aria-label="Workout power profile">
      {bars.map((b, i) => (
        <div
          key={i}
          className="min-w-0 rounded-t-[2px]"
          style={{ flex: `${b.minutes} 1 0`, height: `${b.heightPct}%`, background: b.color }}
          title={`${b.pct}% FTP · ${Math.round(b.minutes * 10) / 10} min`}
        />
      ))}
    </div>
  );
}
