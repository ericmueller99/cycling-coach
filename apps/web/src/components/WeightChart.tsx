import { addDays, daysBetween, formatShortDate } from '@cycling-coach/core';
import type { WeightPoint } from '@cycling-coach/shared';
import { useEffect, useRef, useState } from 'react';

export const WEIGHT_RANGES = [14, 30, 90] as const;
export type WeightRange = (typeof WEIGHT_RANGES)[number];

/** The points in the last `days` up to the latest weigh-in. */
export function inRange(points: readonly WeightPoint[], days: number): WeightPoint[] {
  const last = points[points.length - 1];
  return last ? points.filter((p) => daysBetween(p.date, last.date) < days) : [];
}

const FULL = { height: 170, pad: { left: 36, right: 10, top: 10, bottom: 26 } };
/** Mobile: the trend line on a baseline, no axis labels. */
const COMPACT = { height: 70, pad: { left: 4, right: 6, top: 6, bottom: 8 } };
const DOT = '#A3AAB6';

/** Tracks an element's width so the SVG draws in real pixels and its text never scales. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Weigh-ins as dots and the 7-day trend as a line, x by date over the whole range so
 * gaps in weigh-ins show as gaps. `points` is the full history; the range picks the window.
 * `compact` draws only the trend line, with no legend, range toggle or labels (mobile).
 */
export function WeightChart({
  points,
  days,
  onDaysChange,
  loading = false,
  compact = false,
}: {
  points: readonly WeightPoint[];
  days: WeightRange;
  onDaysChange?: (d: WeightRange) => void;
  loading?: boolean;
  compact?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const shown = inRange(points, days);
  const last = shown[shown.length - 1];

  if (compact) {
    return (
      <div ref={ref}>
        {!last ? (
          <div className="flex items-center justify-center text-[13px] text-muted" style={{ height: COMPACT.height }}>
            {loading ? 'Loading weigh-ins…' : 'No weigh-ins from intervals.icu yet.'}
          </div>
        ) : (
          width > 0 && <Plot points={shown} days={days} end={last.date} width={width} compact />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-divider px-3 pt-3 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3.5 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-sm bg-accent-ink" />
            7-day trend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: DOT }} />
            Weigh-ins
          </span>
        </div>
        <div role="group" aria-label="Range" className="flex rounded-lg bg-surface-2 p-[3px]">
          {WEIGHT_RANGES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => onDaysChange?.(d)}
              className={`min-h-7 rounded-md border-0 px-2.5 text-xs ${days === d ? 'bg-surface font-semibold text-ink' : 'bg-transparent text-muted'}`}
            >
              {d} d
            </button>
          ))}
        </div>
      </div>
      <div ref={ref}>
        {!last ? (
          <div className="flex items-center justify-center text-[13px] text-muted" style={{ height: FULL.height }}>
            {loading ? 'Loading weigh-ins…' : 'No weigh-ins from intervals.icu yet.'}
          </div>
        ) : (
          width > 0 && <Plot points={shown} days={days} end={last.date} width={width} />
        )}
      </div>
    </div>
  );
}

function Plot({ points, days, end, width, compact = false }: { points: WeightPoint[]; days: number; end: string; width: number; compact?: boolean }) {
  const { height: HEIGHT, pad: PAD } = compact ? COMPACT : FULL;
  const start = addDays(end, -(days - 1));
  const values = points.flatMap((p) => [p.kg, p.trendKg]);
  let lo = Math.floor(Math.min(...values) - 0.2);
  let hi = Math.ceil(Math.max(...values) + 0.2);
  if (hi - lo < 2) [lo, hi] = [lo - 1, hi + 1];
  const step = hi - lo > 6 ? 2 : 1;
  const grid = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);

  const x0 = PAD.left;
  const x1 = width - PAD.right;
  const y0 = PAD.top;
  const y1 = HEIGHT - PAD.bottom;
  const x = (date: string) => x0 + (daysBetween(start, date) / Math.max(1, days - 1)) * (x1 - x0);
  const y = (kg: number) => y1 - ((kg - lo) / (hi - lo)) * (y1 - y0);
  // Five date labels need ~90 px each; narrow charts get three.
  const tickCount = width < 480 ? 3 : 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => addDays(start, Math.round((i * (days - 1)) / (tickCount - 1))));
  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <svg
      role="img"
      aria-label={`Weight over the last ${days} days: trend from ${first.trendKg.toFixed(1)} to ${last.trendKg.toFixed(1)} kg`}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width={width}
      height={HEIGHT}
      className="block"
    >
      {compact ? (
        <line x1={0} x2={width} y1={HEIGHT - 1} y2={HEIGHT - 1} className="stroke-divider" />
      ) : (
        <>
      <g className="fill-faint font-mono text-[11px]">
        {grid.map((kg) => (
          <text key={kg} x={0} y={y(kg)} dominantBaseline="middle">
            {kg}
          </text>
        ))}
        {ticks.map((date, i) => (
          <text key={date} x={x(date)} y={HEIGHT - 6} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>
            {formatShortDate(date)}
          </text>
        ))}
      </g>
      <g className="stroke-divider">
        {grid.map((kg) => (
          <line key={kg} x1={x0 - 8} x2={x1 + 6} y1={y(kg)} y2={y(kg)} />
        ))}
      </g>
      {points.map((p) => (
        <circle key={p.date} cx={x(p.date)} cy={y(p.kg)} r={3} fill={DOT}>
          <title>{`${formatShortDate(p.date)} · ${p.kg} kg (trend ${p.trendKg})`}</title>
        </circle>
      ))}
        </>
      )}
      <polyline
        points={points.map((p) => `${x(p.date).toFixed(1)},${y(p.trendKg).toFixed(1)}`).join(' ')}
        fill="none"
        className="stroke-accent-ink"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(last.date)} cy={y(last.trendKg)} r={4.5} className="fill-surface stroke-accent-ink" strokeWidth={2.5} />
    </svg>
  );
}
