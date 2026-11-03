import { formatShortDate, wattsPerKg } from '@cycling-coach/core';
import { powerBestDurations, type PowerBest } from '@cycling-coach/shared';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, Card, ErrorNote } from '../../components/ui';
import { errorMessage, useProfileMutations } from '../../lib/queries';
import { durLabel, inputCls, PERIODS } from './shared';

const W = 600;
const H = 180;
const PAD = { l: 40, r: 12, t: 12, b: 22 };
const X_MIN = Math.log(5);
const X_MAX = Math.log(3600);
const xAt = (sec: number) => PAD.l + ((Math.log(sec) - X_MIN) / (X_MAX - X_MIN)) * (W - PAD.l - PAD.r);
const X_TICKS = [5, 15, 60, 300, 1200, 3600];

/** Log-x power curve through the stored bests, with the FTP line dashed across. */
function CurveChart({ rows, ftp }: { rows: PowerBest[]; ftp: number | undefined }) {
  const pts = rows.filter((r): r is PowerBest & { watts: number } => !!r.watts);
  const values = [...pts.map((p) => p.watts), ...(ftp ? [ftp] : [])];
  if (!values.length) values.push(200);
  const lo = Math.max(0, Math.floor((Math.min(...values) * 0.85) / 50) * 50);
  const hi = Math.ceil((Math.max(...values) * 1.05) / 50) * 50;
  const yAt = (w: number) => PAD.t + (1 - (w - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const step = hi - lo > 600 ? 200 : 100;
  const grid: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid.push(v);
  const line = pts.map((p) => `${xAt(p.durationSec).toFixed(1)},${yAt(p.watts).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Power curve: ${pts.map((p) => `${durLabel(p.durationSec)} ${p.watts} W`).join(', ') || 'no data'}`}>
      {grid.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={yAt(v)} y2={yAt(v)} stroke="#EDEFF2" />
          <text x={PAD.l - 6} y={yAt(v) + 3} textAnchor="end" fontSize="10" fill="#8A93A3" fontFamily="ui-monospace, monospace">
            {v}
          </text>
        </g>
      ))}
      {X_TICKS.map((t, i) => (
        <text key={t} x={xAt(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === X_TICKS.length - 1 ? 'end' : 'middle'} fontSize="10" fill="#8A93A3" fontFamily="ui-monospace, monospace">
          {durLabel(t).replace(' ', '')}
        </text>
      ))}
      {ftp && (
        <>
          <line x1={PAD.l} x2={W - PAD.r} y1={yAt(ftp)} y2={yAt(ftp)} stroke="#7DA30A" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x={W - PAD.r} y={yAt(ftp) - 5} textAnchor="end" fontSize="10" fill="#3F6212" fontWeight="600">
            FTP {ftp}
          </text>
        </>
      )}
      {pts.length > 1 && <polyline points={line} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinejoin="round" />}
      {pts.map((p) => (
        <circle key={p.durationSec} cx={xAt(p.durationSec)} cy={yAt(p.watts)} r="3.5" fill="#FFFFFF" stroke="#2563EB" strokeWidth="2" />
      ))}
    </svg>
  );
}

/**
 * Power curve: the 11 stored bests per period as a curve and tiles. A tile opens
 * an override — kept while it's higher than intervals.icu's; empty goes back to the synced value.
 */
export function PowerCurveCard({ bests, weightKg, ftp, goalDurations }: { bests: PowerBest[]; weightKg: number; ftp: number | undefined; goalDurations: number[] }) {
  const { savePowerBests } = useProfileMutations();
  const [period, setPeriod] = useState<PowerBest['period']>('90d');
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const rows: PowerBest[] = powerBestDurations.map((d) => bests.find((b) => b.period === period && b.durationSec === d) ?? { period, durationSec: d });
  const row = editing === null ? undefined : rows.find((r) => r.durationSec === editing);

  const open = (r: PowerBest) => {
    setEditing(r.durationSec);
    setValue(r.watts?.toString() ?? '');
    savePowerBests.reset();
  };
  const close = () => setEditing(null);
  const save = () => {
    if (!row) return;
    const { activityId: _drop, ...existing } = row;
    const next: PowerBest =
      value === '' ? { period: existing.period, durationSec: existing.durationSec } : { ...existing, watts: Number(value), date: new Date().toISOString().slice(0, 10), source: 'Entered manually' };
    savePowerBests.mutate([next], { onSuccess: close });
  };
  const sourceText = (r: PowerBest) => (r.source ? `${r.source}${r.date ? ` · ${formatShortDate(r.date)}` : ''}` : 'Not set');

  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="m-0 text-base">Power curve</h2>
          <div className="text-xs text-muted">From intervals.icu · tap a value to override it</div>
        </div>
        <div role="group" aria-label="Period" className="flex rounded-[10px] border border-line-strong bg-surface p-[3px] mobile:w-full">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={`min-h-8 rounded-lg border-0 px-2.5 text-[13px] mobile:min-h-[38px] mobile:flex-1 ${period === p.key ? 'bg-track font-semibold text-ink' : 'bg-transparent text-muted'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <CurveChart rows={rows} ftp={ftp} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
        {rows.map((r) => {
          const goal = goalDurations.includes(r.durationSec);
          return (
            <button
              key={r.durationSec}
              type="button"
              onClick={() => open(r)}
              aria-label={`${durLabel(r.durationSec)}: ${r.watts ? `${r.watts} W` : 'not set'} — edit`}
              className={`flex min-h-[64px] flex-col items-start justify-center gap-0.5 rounded-[10px] border px-2.5 py-2 text-left ${goal ? 'border-accent-ring bg-accent-tint' : 'border-line bg-surface-2'}`}
            >
              <span className="text-[11px] text-muted">{durLabel(r.durationSec)}</span>
              <span className="font-mono text-[15px] font-semibold text-ink">{r.watts ? `${r.watts}` : '—'}</span>
              <span className="font-mono text-[11px] text-muted">{r.watts ? `${wattsPerKg(r.watts, weightKg).toFixed(2)} W/kg` : 'W'}</span>
            </button>
          );
        })}
      </div>
      <div className="text-xs text-muted">
        {goalDurations.length > 0 ? 'Highlighted durations are goals. ' : ''}W/kg at trend weight. Overrides are kept while they're higher than intervals.icu's.
      </div>
      {row && (
        <Dialog
          title={`${durLabel(row.durationSec)} power best`}
          eyebrow={PERIODS.find((p) => p.key === period)?.label}
          width={420}
          onClose={close}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" disabled={value === (row.watts?.toString() ?? '') || savePowerBests.isPending} onClick={save}>
                {savePowerBests.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Watts
              <input autoFocus type="number" inputMode="numeric" placeholder="— W" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputCls} min-h-[44px]`} />
            </label>
            <div className="flex justify-between text-xs text-muted">
              <span>{Number(value) ? `${wattsPerKg(Number(value), weightKg).toFixed(2)} W/kg` : '—'}</span>
              <span>
                {row.source === 'intervals.icu' && row.activityId ? (
                  <a href={`https://intervals.icu/activities/${row.activityId}`} target="_blank" rel="noreferrer">
                    intervals.icu
                  </a>
                ) : (
                  sourceText(row)
                )}
              </span>
            </div>
            <div className="text-xs text-muted">Leave it empty to go back to the intervals.icu value.</div>
            {savePowerBests.error && <ErrorNote>{errorMessage(savePowerBests.error)}</ErrorNote>}
          </div>
        </Dialog>
      )}
    </Card>
  );
}
