import { wattsPerKg, zwiftWeightDrift } from '@cycling-coach/core';
import { errorMessage, useProfile, useProfileMutations } from '../lib/queries';
import { WarningIcon } from './icons';
import { Button } from './ui';

/**
 * Nudge to update Zwift when its weight has drifted more than the tolerance from the 7-day trend.
 * When the Zwift weight syncs from Zwift there's nothing to set here — it follows Zwift.
 * With `zftp`, also says what zFTP W/kg would be at the trend weight.
 */
export function ZwiftWeightAlert({
  zwiftKg,
  trendKg,
  zftp,
  synced = false,
  compact = false,
}: {
  zwiftKg: number | undefined;
  trendKg: number;
  zftp?: number | undefined;
  synced?: boolean | undefined;
  compact?: boolean;
}) {
  const drift = zwiftWeightDrift(zwiftKg, trendKg);
  return drift === null ? null : <Alert drift={drift} trendKg={trendKg} zftp={zftp} synced={synced} compact={compact} />;
}

function Alert({ drift, trendKg, zftp, synced, compact }: { drift: number; trendKg: number; zftp: number | undefined; synced: boolean; compact: boolean }) {
  const profile = useProfile();
  const { saveProfile } = useProfileMutations();
  const off = `${Math.abs(drift).toFixed(1)} kg ${drift > 0 ? 'above' : 'below'}`;
  return (
    <div role="status" className="flex gap-2.5 rounded-[10px] border border-[#F3D58A] bg-[#FFF8E6] px-3 py-2.5 text-[13px] text-[#7A4B00]">
      <WarningIcon className="mt-0.5 flex-none" />
      <div className="flex flex-col gap-2">
        {compact ? (
          <span>{`Zwift weight is ${off} trend (${trendKg} kg).`}</span>
        ) : (
          <span>
            <strong>{`Zwift weight is ${off} your 7-day trend (${trendKg} kg).`}</strong>
            {` Update it in Zwift${synced ? '; it syncs back here.' : ', then here.'}`}
            {zftp ? ` At ${trendKg} kg your zFTP would be ${wattsPerKg(zftp, trendKg).toFixed(2)} W/kg.` : ''}
          </span>
        )}
        {!synced && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={!profile.data || saveProfile.isPending}
            onClick={() => profile.data && saveProfile.mutate({ ...profile.data.profile, zwiftWeightKg: trendKg })}
          >
            {saveProfile.isPending ? 'Saving…' : `Set Zwift weight to ${trendKg} kg`}
          </Button>
        )}
        {saveProfile.error && <span className="text-danger">{errorMessage(saveProfile.error)}</span>}
      </div>
    </div>
  );
}
