import { formatShortDate } from '@cycling-coach/core';
import type { ChainDue } from '@cycling-coach/shared';
import { errorMessage, useEquipmentMutations } from '../lib/queries';
import { WarningIcon } from './icons';
import { Button } from './ui';

/** "Due a re-wax" text, as the alert and the bike card say it. */
export function dueText(c: Pick<ChainDue, 'name' | 'km' | 'rewaxKm' | 'lastWaxedAt'>): string {
  return `${c.name}'s chain is due a re-wax: ${Math.round(c.km)} km since ${formatShortDate(c.lastWaxedAt.slice(0, 10))} (every ${c.rewaxKm} km).`;
}

/**
 * A waxed chain past its interval (DECISIONS #114), with the one action that clears it. Marking it
 * re-waxed is the rider's own click, so it starts the counter again straight away.
 */
export function ChainAlert({ chain, compact = false }: { chain: ChainDue; compact?: boolean }) {
  const { waxed } = useEquipmentMutations();
  return (
    <div role="status" className="flex gap-2.5 rounded-[10px] border border-[#F3D58A] bg-[#FFF8E6] px-3 py-2.5 text-[13px] text-[#7A4B00]">
      <WarningIcon className="mt-0.5 flex-none" />
      <div className="flex min-w-0 flex-col gap-2">
        {compact ? (
          <span>{`${chain.name}: re-wax due (${Math.round(chain.km)} / ${chain.rewaxKm} km).`}</span>
        ) : (
          <span>
            <strong>{dueText(chain)}</strong> Mark it once it's done, and the count starts again.
          </span>
        )}
        <Button size="sm" variant="ghost" className="self-start" disabled={waxed.isPending} onClick={() => waxed.mutate(chain.bikeId)}>
          {waxed.isPending ? 'Saving…' : 'Mark re-waxed'}
        </Button>
        {waxed.error && <span className="text-danger">{errorMessage(waxed.error)}</span>}
      </div>
    </div>
  );
}

/** Every due chain, for the Coach rail and the Today strip. */
export function ChainAlerts({ chains, compact = false }: { chains: ChainDue[] | undefined; compact?: boolean }) {
  if (!chains?.length) return null;
  return (
    <>
      {chains.map((c) => (
        <ChainAlert key={c.bikeId} chain={c} compact={compact} />
      ))}
    </>
  );
}
