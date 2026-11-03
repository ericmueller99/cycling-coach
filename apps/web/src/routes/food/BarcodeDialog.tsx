import { computePortion, rankByUse } from '@cycling-coach/core';
import type { BarcodeLookup, Food, FoodLibrary } from '@cycling-coach/shared';
import { useMemo, useState } from 'react';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { Dialog } from '../../components/Dialog';
import { Button, ErrorNote, Spinner, inputCls } from '../../components/ui';
import { fmtKcal, itemUsage } from '../../lib/food';
import { lookupBarcode, useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { SourceTag } from './SourceTag';

type Off = NonNullable<BarcodeLookup['openFoodFacts']>;

/**
 * Scan a barcode. One of the user's foods → straight to logging it. Unknown → Open
 * Food Facts' product to review, link the code to one of their foods, or read the label. Nothing is saved
 * here without a tap.
 */
export function BarcodeDialog({
  lib,
  today,
  onClose,
  onFound,
  onReviewOff,
  onPhoto,
  onManual,
}: {
  lib: FoodLibrary;
  today: string;
  onClose: () => void;
  /** The code is (now) on one of the user's foods. */
  onFound: (food: Food) => void;
  onReviewOff: (product: Off) => void;
  onPhoto: (barcode: string) => void;
  onManual: (barcode: string) => void;
}) {
  const m = useFoodMutations();
  const [lookup, setLookup] = useState<BarcodeLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState('');

  const onCode = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await lookupBarcode(code);
      if (r.food) onFound(r.food);
      else setLookup(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const foods = useMemo(() => {
    const active = lib.foods.filter((f) => !f.archived);
    return (q.trim() ? rankByUse(active, q, (f) => itemUsage(lib, { kind: 'food', id: f.id }), today) : active).slice(0, 12);
  }, [lib, q, today]);

  const link = (food: Food) =>
    m.updateFood.mutate(
      { id: food.id, patch: { barcodes: [...food.barcodes, lookup!.barcode] } },
      { onSuccess: (f) => onFound(f), onError: (e) => setError(errorMessage(e)) },
    );

  let body;
  if (!lookup) {
    body = (
      <>
        {busy ? <Spinner label="Looking it up…" /> : <BarcodeScanner onCode={(c) => void onCode(c)} />}
        {error && <ErrorNote>{error}</ErrorNote>}
      </>
    );
  } else if (linking) {
    body = (
      <>
        <div className="text-[13px] text-muted">Pick the food this barcode belongs to — next time a scan finds it straight away.</div>
        <input type="search" aria-label="Search your foods" placeholder="Search your foods" value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} />
        <div className="flex flex-col overflow-hidden rounded-[10px] border border-line">
          {foods.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={m.updateFood.isPending}
              onClick={() => link(f)}
              className="flex min-h-12 items-center gap-2 border-0 border-b border-divider bg-surface px-3 text-left text-ink last:border-b-0 hover:bg-surface-2"
            >
              <span className="min-w-0 flex-auto truncate font-medium">{f.name}</span>
              <SourceTag source={f.source} />
            </button>
          ))}
          {!foods.length && <div className="p-3 text-[13px] text-muted">No foods yet.</div>}
        </div>
        <Button variant="ghost" onClick={() => setLinking(false)}>
          Back
        </Button>
        {error && <ErrorNote>{error}</ErrorNote>}
      </>
    );
  } else {
    const off = lookup.openFoodFacts;
    const offKcal = off ? computePortion(off, 1, 'serving')?.nutrients.kcal : undefined;
    body = (
      <>
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
          <span className="font-mono">{lookup.barcode}</span> isn't in your foods yet.
        </div>
        {off ? (
          <div className="flex gap-3 rounded-[12px] border border-line p-3">
            {off.imageUrl && <img src={off.imageUrl} alt="" className="h-20 w-20 flex-none rounded-lg object-contain" />}
            <div className="flex min-w-0 flex-auto flex-col gap-1">
              <div className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Found on Open Food Facts</div>
              <div className="font-semibold">{off.name}</div>
              <div className="text-xs text-muted">
                {off.brand ? `${off.brand} · ` : ''}
                {offKcal != null ? `${fmtKcal(offKcal)} kcal per ${off.servingLabel}` : ''}
              </div>
              <div className="text-xs text-muted">Community data — check it against the package before saving.</div>
              <div className="mt-1">
                <Button size="sm" variant="primary" onClick={() => onReviewOff(off)}>
                  Review &amp; save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-muted">{lookup.offError ?? 'Open Food Facts doesn’t know this one either.'}</div>
        )}
        <div className="flex flex-col gap-2">
          <Button onClick={() => onPhoto(lookup.barcode)}>Add from the nutrition label</Button>
          <Button onClick={() => setLinking(true)} disabled={!lib.foods.some((f) => !f.archived)}>
            Link to one of my foods
          </Button>
          <Button variant="ghost" onClick={() => onManual(lookup.barcode)}>
            Enter manually
          </Button>
        </div>
      </>
    );
  }

  return (
    <Dialog title="Scan a barcode" width={520} onClose={onClose}>
      {body}
    </Dialog>
  );
}
