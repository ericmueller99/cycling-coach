import { wattsPerKg } from '@cycling-coach/core';
import type { IntegrationStatus, Profile } from '@cycling-coach/shared';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorNote } from '../../components/ui';
import { errorMessage, useProfileMutations } from '../../lib/queries';
import { inputCls } from './shared';

/** FTP card: FTP, W/kg at trend weight and at Zwift weight. Timezone moved to Account. */
export function FtpCard({ profile, intervals }: { profile: Profile; intervals: IntegrationStatus | undefined }) {
  const { saveProfile } = useProfileMutations();
  const [ftp, setFtp] = useState<number | undefined>(profile.ftpZwift);
  useEffect(() => setFtp(profile.ftpZwift), [profile.ftpZwift]);
  const dirty = ftp !== profile.ftpZwift;

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-base">FTP</h2>
        <Button variant={dirty ? 'primary' : 'neutral'} size="sm" disabled={!dirty || saveProfile.isPending} onClick={() => saveProfile.mutate({ ...profile, ftpZwift: ftp })}>
          {saveProfile.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <label className="flex flex-col gap-1 text-xs text-muted">
          FTP (W)
          <input
            type="number"
            className={inputCls}
            value={ftp ?? ''}
            placeholder="Not set"
            onChange={(e) => setFtp(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted" title="FTP ÷ 7-day trend weight">
          W/kg · trend
          <div className="flex min-h-[42px] items-center rounded-lg bg-surface-2 px-2.5 font-mono text-[15px] font-semibold text-accent-ink">{ftp ? wattsPerKg(ftp, profile.weightKg).toFixed(2) : '—'}</div>
        </div>
        <div className="flex flex-col gap-1 text-xs text-muted" title="FTP ÷ the weight set in Zwift">
          W/kg · Zwift
          <div className="flex min-h-[42px] items-center rounded-lg bg-surface-2 px-2.5 font-mono text-[15px] font-semibold text-ink">
            {ftp && profile.zwiftWeightKg ? wattsPerKg(ftp, profile.zwiftWeightKg).toFixed(2) : '—'}
          </div>
        </div>
      </div>
      <div className="text-xs text-muted">
        {profile.ftpZwift ? 'Used for workout targets and zones.' : 'Not set yet. Ride the FTP Ramp Test, or enter a number you trust; until then, workouts show % of FTP.'}
      </div>
      {intervals?.status === 'connected' && intervals.ftp && intervals.ftp !== ftp && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-data-tint px-3 py-2 text-[13px]">
          <span className="flex-1">intervals.icu has FTP {intervals.ftp} W.</span>
          <Button size="sm" variant="ghost" onClick={() => setFtp(intervals.ftp!)}>
            Use it
          </Button>
        </div>
      )}
      {saveProfile.error && <ErrorNote>{errorMessage(saveProfile.error)}</ErrorNote>}
    </Card>
  );
}
