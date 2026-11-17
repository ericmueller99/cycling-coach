import { takesBike } from '@cycling-coach/core';
import type { CalendarActivity } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { ErrorNote } from '../../components/ui';
import { errorMessage, useEquipment, useEquipmentMutations } from '../../lib/queries';

const NONE = '__none';

/**
 * Which bike each ride was on (DECISIONS #114). Shown once the rider has a bike; a choice here is
 * theirs, and no default moves it after.
 */
export function RideBikes({ rides }: { rides: readonly CalendarActivity[] }) {
  const { data } = useEquipment();
  const { setRideBike } = useEquipmentMutations();
  const cycling = rides.filter(takesBike);
  if (!data?.bikes.length || !cycling.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
      {cycling.map((ride) => (
        <label key={ride.id} className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-muted">{cycling.length > 1 ? ride.name : 'Bike'}</span>
          <select
            aria-label={`Bike for ${ride.name}`}
            value={ride.bikeId === null ? NONE : (ride.bikeId ?? '')}
            disabled={setRideBike.isPending}
            onChange={(e) => setRideBike.mutate({ activityId: ride.id, bikeId: e.target.value === NONE ? null : e.target.value })}
            className="min-h-9 max-w-[60%] rounded-lg border border-line-strong bg-surface px-2 text-ink mobile:min-h-[44px] mobile:text-base"
          >
            {ride.bikeId === undefined && (
              <option value="" disabled>
                Choose a bike
              </option>
            )}
            {data.bikes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value={NONE}>No bike</option>
          </select>
        </label>
      ))}
      {setRideBike.error && <ErrorNote>{errorMessage(setRideBike.error)}</ErrorNote>}
      <Link to="/athlete/$tab" params={{ tab: 'equipment' }} className="self-start text-xs">
        Bikes and chains
      </Link>
    </div>
  );
}
