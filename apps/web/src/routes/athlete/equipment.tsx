import { CHAIN_WARN_SHARE, endOfDay, formatShortDate } from '@cycling-coach/core';
import {
  CHAIN_LABEL,
  REWAX_KM_MAX,
  REWAX_KM_MIN,
  REWAX_KM_SUGGESTED,
  type BikeInput,
  type BikePatch,
  type BikeStatus,
  type Chain,
  type ChainType,
  type RideKind,
} from '@cycling-coach/shared';
import { useState } from 'react';
import { ChainAlert } from '../../components/ChainAlert';
import { Dialog } from '../../components/Dialog';
import { PencilIcon, TrashIcon } from '../../components/icons';
import { Button, Card, ErrorNote, inputCls, ProgressBar, SectionLabel, Segmented, Spinner, Tag } from '../../components/ui';
import { errorMessage, useEquipment, useEquipmentMutations } from '../../lib/queries';

/**
 * Equipment (DECISIONS #114): the rider's bikes, what's on each, and when a waxed chain is due.
 * Rides take their kind's default bike; any ride can be moved from the calendar.
 */

const KIND_LABEL: Record<RideKind, string> = { indoor: 'Indoor default', outdoor: 'Outdoor default' };
const km = (n: number) => `${Math.round(n).toLocaleString('en-CA')} km`;

const Empty = ({ children }: { children: string }) => (
  <div className="rounded-[10px] border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">{children}</div>
);

export function BikesSection() {
  const { data, isPending, error } = useEquipment();
  const [editing, setEditing] = useState<BikeStatus | 'new' | null>(null);
  return (
    <Card className="flex flex-col gap-3.5 p-[18px]">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-base">Bikes</h2>
        <Button size="sm" variant="ghost" onClick={() => setEditing('new')}>
          + Add bike
        </Button>
      </div>
      {isPending ? (
        <Spinner />
      ) : error ? (
        <ErrorNote>{errorMessage(error)}</ErrorNote>
      ) : data.bikes.length ? (
        data.bikes.map((b) => <BikeCard key={b.id} bike={b} onEdit={() => setEditing(b)} />)
      ) : (
        <Empty>No bikes yet. Add each bike you ride, and pick one for indoor rides and one for outdoor rides.</Empty>
      )}
      {editing && <BikeDialog bike={editing === 'new' ? undefined : editing} bikes={data?.bikes ?? []} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function BikeCard({ bike, onEdit }: { bike: BikeStatus; onEdit: () => void }) {
  const { remove, waxed } = useEquipmentMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wear = bike.chain.type === 'waxed' ? bike.wear : undefined;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2 font-semibold">
          {bike.name}
          {bike.defaultFor && <Tag tone="accent">{KIND_LABEL[bike.defaultFor]}</Tag>}
          <Tag>{CHAIN_LABEL[bike.chain.type]} chain</Tag>
        </span>
        <span className="flex flex-none items-center gap-2 text-muted">
          <button type="button" aria-label={`Edit ${bike.name}`} onClick={onEdit} className="border-0 bg-transparent text-muted">
            <PencilIcon />
          </button>
          <button type="button" aria-label={`Delete ${bike.name}`} onClick={() => setConfirmDelete(true)} className="border-0 bg-transparent text-muted">
            <TrashIcon />
          </button>
        </span>
      </div>
      <div className="font-mono text-[11px] text-muted">
        {km(bike.km)} · {bike.rides} {bike.rides === 1 ? 'ride' : 'rides'}
      </div>
      {bike.notes && <div className="text-xs text-muted">{bike.notes}</div>}
      {wear && bike.chain.type === 'waxed' && (
        <>
          <ProgressBar value={wear.share} height={6} tone={wear.share >= CHAIN_WARN_SHARE ? 'warn' : 'accent'} />
          <div className="flex flex-wrap justify-between gap-x-3 font-mono text-[11px] text-muted">
            <span>
              {Math.round(wear.km)} / {bike.chain.rewaxKm} km since wax · {wear.rides} {wear.rides === 1 ? 'ride' : 'rides'}
            </span>
            <span>waxed {formatShortDate(bike.chain.lastWaxedAt.slice(0, 10))}</span>
          </div>
          {wear.due ? (
            <ChainAlert chain={{ bikeId: bike.id, name: bike.name, km: wear.km, rewaxKm: bike.chain.rewaxKm, lastWaxedAt: bike.chain.lastWaxedAt }} />
          ) : (
            <Button size="sm" variant="ghost" className="self-start" disabled={waxed.isPending} onClick={() => waxed.mutate(bike.id)}>
              {waxed.isPending ? 'Saving…' : 'Mark re-waxed'}
            </Button>
          )}
          {waxed.error && <ErrorNote>{errorMessage(waxed.error)}</ErrorNote>}
        </>
      )}
      {confirmDelete && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
          <span>
            Delete {bike.name}?{' '}
            {bike.rides ? `Its ${bike.rides} ${bike.rides === 1 ? 'ride stays' : 'rides stay'} on no bike, and no default takes them.` : ''}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(bike.id)}>
              {remove.isPending ? 'Deleting…' : 'Delete bike'}
            </Button>
          </span>
          {remove.error && <ErrorNote>{errorMessage(remove.error)}</ErrorNote>}
        </div>
      )}
    </div>
  );
}

type DefaultChoice = RideKind | 'none';

function BikeDialog({ bike, bikes, onClose }: { bike: BikeStatus | undefined; bikes: BikeStatus[]; onClose: () => void }) {
  const { create, update } = useEquipmentMutations();
  const wasWaxed = bike?.chain.type === 'waxed' ? bike.chain : undefined;
  const [name, setName] = useState(bike?.name ?? '');
  const [defaultFor, setDefaultFor] = useState<DefaultChoice>(bike?.defaultFor ?? 'none');
  const [chainType, setChainType] = useState<ChainType>(bike?.chain.type ?? 'waxed');
  const [rewaxKm, setRewaxKm] = useState(String(wasWaxed?.rewaxKm ?? REWAX_KM_SUGGESTED));
  const [waxedOn, setWaxedOn] = useState(wasWaxed?.lastWaxedAt.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(bike?.notes ?? '');
  const save = bike ? update : create;

  const takesOver = defaultFor !== 'none' && bikes.find((b) => b.defaultFor === defaultFor && b.id !== bike?.id);
  const interval = Number(rewaxKm);
  const intervalOk = Number.isInteger(interval) && interval >= REWAX_KM_MIN && interval <= REWAX_KM_MAX;
  const ok = name.trim() && (chainType === 'lubed' || (intervalOk && waxedOn));

  const chain = (): Chain =>
    chainType === 'lubed'
      ? { type: 'lubed' }
      : {
          type: 'waxed',
          rewaxKm: interval,
          // An unchanged date keeps its time (a "Mark re-waxed" has one); a typed date is the end of that day.
          lastWaxedAt: wasWaxed && wasWaxed.lastWaxedAt.slice(0, 10) === waxedOn ? wasWaxed.lastWaxedAt : endOfDay(waxedOn),
        };

  const submit = () => {
    if (!ok) return;
    const fields = { name: name.trim(), chain: chain(), ...(notes.trim() ? { notes: notes.trim() } : {}), ...(defaultFor !== 'none' ? { defaultFor } : {}) };
    if (bike) {
      const unset: NonNullable<BikePatch['unset']> = [...(defaultFor === 'none' && bike.defaultFor ? ['defaultFor' as const] : []), ...(!notes.trim() && bike.notes ? ['notes' as const] : [])];
      update.mutate({ id: bike.id, patch: { ...fields, ...(unset.length ? { unset } : {}) } }, { onSuccess: onClose });
    } else {
      create.mutate(fields satisfies BikeInput, { onSuccess: onClose });
    }
  };

  return (
    <Dialog
      title={bike ? `Edit ${bike.name}` : 'Add a bike'}
      width={460}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok || save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : bike ? 'Save' : 'Add bike'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Name
          <input autoFocus value={name} maxLength={60} placeholder="e.g. Road bike" onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted">
          Default for
          <Segmented<DefaultChoice>
            label="Default for"
            value={defaultFor}
            onChange={setDefaultFor}
            options={[
              { key: 'none', label: 'Neither' },
              { key: 'indoor', label: 'Indoor rides' },
              { key: 'outdoor', label: 'Outdoor rides' },
            ]}
          />
          <span>
            {takesOver
              ? `Takes over from ${takesOver.name}. Rides already on a bike stay where they are.`
              : 'New rides of this kind go to this bike. Rides with no bike yet go to it too.'}
          </span>
        </div>
        <div className="flex flex-col gap-1 text-xs text-muted">
          Chain
          <Segmented<ChainType>
            label="Chain"
            value={chainType}
            onChange={setChainType}
            options={[
              { key: 'waxed', label: 'Waxed' },
              { key: 'lubed', label: 'Lubed' },
            ]}
          />
          {chainType === 'lubed' && <span>Nothing is tracked on a lubed chain yet.</span>}
        </div>
        {chainType === 'waxed' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Re-wax every (km)
              <input type="number" inputMode="numeric" min={REWAX_KM_MIN} max={REWAX_KM_MAX} value={rewaxKm} onChange={(e) => setRewaxKm(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Last waxed
              <input type="date" value={waxedOn} onChange={(e) => setWaxedOn(e.target.value)} className={inputCls} />
            </label>
            <span className="col-span-2 text-xs text-muted">
              {intervalOk ? 'Rides after the day it was waxed count toward the next wax.' : `Between ${REWAX_KM_MIN} and ${REWAX_KM_MAX} km.`}
            </span>
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">
          Notes (optional)
          <input value={notes} maxLength={500} placeholder="e.g. 12-speed, 2025 chain" onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </label>
        {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      </div>
    </Dialog>
  );
}

/** How rides get a bike, what isn't counted, and the re-wax log. */
export function EquipmentNotes() {
  const { data } = useEquipment();
  const waxes = (data?.bikes ?? [])
    .flatMap((b) => b.waxes.map((w) => ({ ...w, bike: b.name })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  return (
    <>
      <Card className="flex flex-col gap-2.5 p-[18px]">
        <h2 className="m-0 text-base">How rides get a bike</h2>
        <div className="text-[13px] text-muted">
          Trainer, Zwift and other virtual rides go to your indoor default. Rides outside go to your outdoor default. Change any ride's bike from the calendar,
          and it stays where you put it.
        </div>
        {!!data?.unassigned.rides && (
          <div className="text-[13px]">
            <strong>
              {data.unassigned.rides} {data.unassigned.rides === 1 ? 'ride' : 'rides'} ({km(data.unassigned.km)})
            </strong>{' '}
            in the last 30 days {data.unassigned.rides === 1 ? 'has' : 'have'} no bike, so {data.unassigned.rides === 1 ? 'it isn’t' : 'they aren’t'} counted.
          </div>
        )}
        <div className="text-xs text-muted">The coach doesn't see your bikes yet.</div>
      </Card>
      {waxes.length > 0 && (
        <Card className="flex flex-col gap-2 p-[18px]">
          <SectionLabel>Re-wax log</SectionLabel>
          {waxes.map((w) => (
            <div key={`${w.bike}-${w.at}`} className="flex justify-between gap-3 border-b border-divider py-1.5 text-[13px] last:border-b-0">
              <span>{w.bike}</span>
              <span className="font-mono text-xs text-muted">
                {formatShortDate(w.at.slice(0, 10))} · {Math.round(w.km)} km
              </span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
