import { wattsPerKg } from '@cycling-coach/core';
import type { Profile } from '@cycling-coach/shared';
import { useState } from 'react';
import { Card, Chip } from '../../components/ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { inputCls } from './shared';

const positive = (s: string): number | undefined => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Watts/kg simulator: any power over any weight, the weight starting at the
 * trend weight. Local state only — nothing is saved or sent to the coach.
 */
export function WkgSimulatorCard({ profile }: { profile: Profile }) {
  const mobile = useIsMobile();
  const trendKg = Math.round(profile.weightKg * 10) / 10;
  const [watts, setWatts] = useState('');
  const [kg, setKg] = useState(String(trendKg));
  const w = positive(watts);
  const k = positive(kg);

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]">
      <div>
        <h2 className="m-0 text-base">Watts/kg simulator</h2>
        <div className="mt-0.5 text-xs text-muted">Try a power and a weight. Nothing here is saved or sent to the coach.</div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Watts
          <input type="number" inputMode="numeric" min={1} className={inputCls} value={watts} placeholder="e.g. 250" onChange={(e) => setWatts(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Weight (kg)
          <input type="number" inputMode="decimal" min={1} step={0.1} className={inputCls} value={kg} onChange={(e) => setKg(e.target.value)} />
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted" aria-live="polite">
          W/kg
          <div className="flex min-h-[42px] items-center rounded-lg bg-surface-2 px-2.5 font-mono text-[15px] font-semibold text-accent-ink">
            {w && k ? wattsPerKg(w, k).toFixed(2) : '—'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {profile.ftpZwift !== undefined && (
          <Chip mobile={mobile} on={w === profile.ftpZwift} onClick={() => setWatts(String(profile.ftpZwift))}>
            FTP {profile.ftpZwift} W
          </Chip>
        )}
        <Chip mobile={mobile} on={k === trendKg} onClick={() => setKg(String(trendKg))}>
          Trend {trendKg.toFixed(1)} kg
        </Chip>
        {profile.zwiftWeightKg !== undefined && (
          <Chip mobile={mobile} on={k === profile.zwiftWeightKg} onClick={() => setKg(String(profile.zwiftWeightKg))}>
            Zwift {profile.zwiftWeightKg.toFixed(1)} kg
          </Chip>
        )}
      </div>
    </Card>
  );
}
