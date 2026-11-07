import {
  canonicalUnit,
  computePortion,
  duplicateMeasureUnits,
  isStandardUnit,
  MASS_UNITS,
  measureFromServingLabel,
  roundTo,
  unitsFor,
  VOLUME_UNITS,
  withMeasure,
} from '@cycling-coach/core';
import {
  nutrientKeys,
  readableNutrientKeys,
  type Food,
  type FoodImageRef,
  type FoodInput,
  type FoodSource,
  type NutrientKey,
  type Nutrients,
  type NutritionReading,
  type PhotoKind,
} from '@cycling-coach/shared';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { TrashIcon, XIcon } from '../../components/icons';
import { Button, ErrorNote, Field, inputCls, Segmented } from '../../components/ui';
import { fmtKcal, NUTRIENT_ROWS, SOURCE_LINE } from '../../lib/food';
import { useFoodImages, useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { AdjustWithAi, withAdjustment } from './AdjustWithAi';

const UNIT_SUGGESTIONS = [...MASS_UNITS, ...VOLUME_UNITS.filter((u) => u !== 'fl_oz'), 'piece', 'slice', 'bar', 'scoop', 'bottle', 'can', 'packet'];

/** The form's editable copy of a food: numbers as typed. */
export interface FoodDraft {
  name: string;
  brand: string;
  servingLabel: string;
  measures: { unit: string; amount: string }[];
  defaultQty: string;
  defaultUnit: string;
  nutrients: Partial<Record<NutrientKey, string>>;
  aliases: string;
  barcodes: string;
  notes: string;
  source: FoodSource;
  sourceRef?: string | undefined;
  images: FoodImageRef[];
}

export const emptyDraft = (name = ''): FoodDraft => ({
  name,
  brand: '',
  servingLabel: '',
  measures: [{ unit: 'g', amount: '' }],
  defaultQty: '1',
  defaultUnit: 'serving',
  nutrients: {},
  aliases: '',
  barcodes: '',
  notes: '',
  source: 'manual',
  images: [],
});

const str = (n: number | undefined) => (n == null ? '' : String(roundTo(n, 2)));

export function draftFromFood(
  f: Pick<Food, 'name' | 'measures' | 'defaultPortion' | 'nutrients' | 'aliases' | 'barcodes' | 'source'> &
    Partial<Pick<Food, 'brand' | 'servingLabel' | 'notes' | 'sourceRef'>> & { images?: readonly FoodImageRef[] | undefined },
): FoodDraft {
  return {
    name: f.name,
    brand: f.brand ?? '',
    servingLabel: f.servingLabel ?? '',
    measures: f.measures.map((m) => ({ unit: m.unit, amount: str(m.amount) })),
    defaultQty: str(f.defaultPortion.quantity),
    defaultUnit: f.defaultPortion.unit,
    nutrients: Object.fromEntries(nutrientKeys.map((k) => [k, str(f.nutrients[k])])),
    aliases: f.aliases.join(', '),
    barcodes: f.barcodes.join(', '),
    notes: f.notes ?? '',
    source: f.source,
    sourceRef: f.sourceRef,
    images: (f.images ?? []).map((i) => ({ key: i.key, kind: i.kind })),
  };
}

/**
 * A reading from a photo → the form, plus the fields to double-check (low confidence). Nothing
 * is saved until the user presses Save.
 */
export function draftFromReading(r: NutritionReading, kind: PhotoKind, images: FoodImageRef[], barcode?: string): { draft: FoodDraft; flags: Set<string>; read: number } {
  const flags = new Set<string>();
  const nutrients: Partial<Record<NutrientKey, string>> = {};
  let read = 0;
  for (const k of readableNutrientKeys) {
    const v = r.nutrients[k];
    if (v.value != null) {
      nutrients[k] = str(v.value);
      read++;
    }
    if (v.confidence === 'low') flags.add(k);
  }
  const measures = r.servingMeasures.filter((m) => m.amount > 0 && m.unit.trim()).map((m) => ({ unit: canonicalUnit(m.unit), amount: str(m.amount) }));
  const servingLabel = r.servingText.replace(/^(per|pour)\s+/i, '').trim();
  const fromLabel = measureFromServingLabel(servingLabel);
  const code = r.barcode.replace(/\D/g, '') || barcode || '';
  if (!code) flags.add('barcode');
  return {
    draft: {
      ...emptyDraft(r.name),
      brand: r.brand,
      servingLabel,
      measures: measures.length ? measures : fromLabel ? [{ unit: fromLabel.unit, amount: str(fromLabel.amount) }] : [{ unit: 'g', amount: '' }],
      nutrients,
      aliases: r.aliases.join(', '),
      barcodes: code,
      notes: r.note,
      source: kind === 'screenshot' ? 'screenshot' : 'label',
      images,
    },
    flags,
    read,
  };
}

const num = (s: string | undefined) => {
  if (s == null || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Draft → API input, or the first problem to show. */
export function draftToInput(d: FoodDraft): { input: FoodInput } | { error: string } {
  if (!d.name.trim()) return { error: 'Give it a name.' };
  const measures = [];
  for (const m of d.measures) {
    // An untouched row (the form starts on a blank "g") isn't a serving size. A typed label unit is.
    if (!m.amount.trim() && (!m.unit.trim() || isStandardUnit(canonicalUnit(m.unit)))) continue;
    const amount = num(m.amount);
    if (!m.unit.trim() || amount == null || !(amount > 0)) return { error: 'Each serving size needs an amount and a unit.' };
    measures.push({ unit: canonicalUnit(m.unit), amount });
  }
  // Not everything has a weight: "1 sandwich" is the serving, and failing that it's just one serving.
  if (!measures.length) measures.push(measureFromServingLabel(d.servingLabel) ?? { unit: 'serving', amount: 1 });
  const dups = duplicateMeasureUnits(measures);
  if (dups.length) return { error: `Two serving sizes use ${dups.join(', ')}.` };
  const nutrients: Partial<Nutrients> = {};
  for (const row of NUTRIENT_ROWS) {
    const v = num(d.nutrients[row.key]);
    if (v === undefined) {
      if (row.required) return { error: `${row.label} is needed (0 is fine).` };
      continue;
    }
    if (Number.isNaN(v) || v < 0) return { error: `${row.label} must be a number.` };
    nutrients[row.key] = v;
  }
  const qty = num(d.defaultQty);
  if (qty == null || !(qty > 0)) return { error: 'The usual portion needs an amount.' };
  const input: FoodInput = {
    name: d.name.trim(),
    ...(d.brand.trim() ? { brand: d.brand.trim() } : {}),
    ...(d.servingLabel.trim() ? { servingLabel: d.servingLabel.trim() } : {}),
    measures,
    defaultPortion: { quantity: qty, unit: canonicalUnit(d.defaultUnit) },
    nutrients: nutrients as Nutrients,
    aliases: list(d.aliases),
    barcodes: list(d.barcodes).map((b) => b.replace(/\D/g, '')),
    source: d.source,
    ...(d.sourceRef ? { sourceRef: d.sourceRef } : {}),
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    images: d.images,
  };
  return { input };
}

/** "1 cup = 120 g": teach the food a measure from something weighed. */
function AddMeasure({ draft, onAdd }: { draft: FoodDraft; onAdd: (unit: string, amount: number) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('1');
  const [unit, setUnit] = useState('cup');
  const [kq, setKq] = useState('');
  const [kunit, setKunit] = useState('g');
  const [error, setError] = useState<string | null>(null);
  const known = draft.measures.filter((m) => m.unit && Number(m.amount) > 0).map((m) => ({ unit: canonicalUnit(m.unit), amount: Number(m.amount) }));
  const knownUnits = known.length ? unitsFor({ measures: known }).filter((u) => u !== 'serving') : [];
  if (!open) {
    return (
      <button type="button" className="self-start border-0 bg-transparent p-0 text-[13px] font-medium text-accent-ink" onClick={() => setOpen(true)}>
        I weighed or measured it…
      </button>
    );
  }
  const apply = () => {
    const measures = withMeasure({ measures: known }, { quantity: Number(q), unit }, { quantity: Number(kq), unit: kunit });
    const added = measures?.find((m) => canonicalUnit(m.unit) === canonicalUnit(unit));
    if (!added) return setError(`Can't work that out — the food needs a ${kunit} serving size first.`);
    onAdd(added.unit, added.amount);
    setOpen(false);
    setError(null);
    setKq('');
  };
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <input aria-label="Amount measured" value={q} onChange={(e) => setQ(e.target.value)} inputMode="decimal" className={`${inputCls} w-16 font-mono`} />
        <input aria-label="Unit measured" value={unit} onChange={(e) => setUnit(e.target.value)} list="food-units" className={`${inputCls} w-24`} />
        <span>=</span>
        <input aria-label="What it weighed" value={kq} onChange={(e) => setKq(e.target.value)} inputMode="decimal" placeholder="120" className={`${inputCls} w-20 font-mono`} />
        <select aria-label="Weighed in" value={kunit} onChange={(e) => setKunit(e.target.value)} className={`${inputCls} w-24`}>
          {(knownUnits.length ? knownUnits : ['g']).map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <Button size="sm" variant="primary" onClick={apply} disabled={!(Number(q) > 0 && Number(kq) > 0)}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <div className="text-xs text-muted">e.g. 1 cup = 120 g. From then on you can log it in cups and the app does the maths.</div>
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}

/**
 * Create or edit a food (and, later, review one read from a photo). Nutrients are per ONE serving
 * as written on the label; the serving sizes say what that serving equals ("175 g", "¾ cup").
 */
export function FoodForm({
  draft,
  onChange,
  flags,
}: {
  draft: FoodDraft;
  onChange: (d: FoodDraft) => void;
  /** Values to double-check (low confidence from a photo): highlighted amber. */
  flags?: ReadonlySet<string> | undefined;
}) {
  const id = useId();
  const set = <K extends keyof FoodDraft>(k: K, v: FoodDraft[K]) => onChange({ ...draft, [k]: v });
  const validMeasures = draft.measures.filter((m) => m.unit.trim() && Number(m.amount) > 0).map((m) => ({ unit: canonicalUnit(m.unit), amount: Number(m.amount) }));
  const portionUnits = validMeasures.length ? unitsFor({ measures: validMeasures }) : ['serving'];
  const flagCls = (k: string) => (flags?.has(k) ? 'border-[#E9B98A] bg-[#FFFBF5]' : '');

  return (
    <div className="flex flex-col gap-4">
      <datalist id="food-units">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-3 mobile:grid-cols-1">
        <Field label="Name" htmlFor={`${id}-name`}>
          <input id={`${id}-name`} value={draft.name} onChange={(e) => set('name', e.target.value)} className={`${inputCls} ${flagCls('name')}`} />
        </Field>
        <Field label={<>Brand <span className="font-normal">· optional</span></>} htmlFor={`${id}-brand`}>
          <input id={`${id}-brand`} value={draft.brand} onChange={(e) => set('brand', e.target.value)} className={inputCls} />
        </Field>
      </div>

      <section className="flex flex-col gap-2">
        <div className="text-[13px] font-semibold">One serving is</div>
        <Field label={<>As written on the label <span className="font-normal">· optional</span></>} htmlFor={`${id}-sl`}>
          <input id={`${id}-sl`} value={draft.servingLabel} placeholder="3/4 cup (175 g)" onChange={(e) => set('servingLabel', e.target.value)} className={`${inputCls} ${flagCls('servingLabel')}`} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-muted">Everything one serving equals — weight, volume, pieces. Add as many as the label shows. No weight on the label? Leave it blank.</div>
          {draft.measures.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-20 flex-none text-[13px] whitespace-nowrap text-muted">{i === 0 ? '1 serving =' : 'or ='}</span>
              <input
                aria-label="Amount"
                inputMode="decimal"
                value={m.amount}
                onChange={(e) => set('measures', draft.measures.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                className={`${inputCls} w-24 font-mono ${flagCls(`measure:${i}`)}`}
              />
              <input
                aria-label="Unit"
                list="food-units"
                value={m.unit}
                onChange={(e) => set('measures', draft.measures.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                className={`${inputCls} w-28`}
              />
              {draft.measures.length > 1 && (
                <button type="button" aria-label="Remove serving size" className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-muted" onClick={() => set('measures', draft.measures.filter((_, j) => j !== i))}>
                  <XIcon />
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-4">
            <button type="button" className="border-0 bg-transparent p-0 text-[13px] font-medium text-accent-ink" onClick={() => set('measures', [...draft.measures, { unit: '', amount: '' }])}>
              + Add serving size
            </button>
          </div>
          <AddMeasure draft={draft} onAdd={(unit, amount) => set('measures', [...draft.measures.filter((x) => canonicalUnit(x.unit) !== unit), { unit, amount: String(amount) }])} />
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">Per serving</span>
          {flags?.size ? <span className="text-xs text-[#9A5B13]">Amber = check against the photo</span> : null}
        </div>
        <div className="columns-2 gap-x-6 mobile:columns-1">
          {NUTRIENT_ROWS.map((row) => (
            <label key={row.key} className={`flex min-h-10 break-inside-avoid items-center gap-2 border-b border-divider ${row.sub ? 'pl-4' : ''}`}>
              <span className={`flex-auto text-[13px] ${row.sub ? '' : 'font-medium'}`}>
                {row.label}
                {flags?.has(row.key) && <span className="ml-1.5 rounded bg-[#FFF4E5] px-1 text-[10px] font-bold text-[#9A5B13]">check</span>}
              </span>
              <input
                inputMode="decimal"
                value={draft.nutrients[row.key] ?? ''}
                placeholder={row.required ? '0' : '—'}
                onChange={(e) => set('nutrients', { ...draft.nutrients, [row.key]: e.target.value })}
                className={`${inputCls} min-h-8 w-24 text-right font-mono ${flagCls(row.key)}`}
              />
              <span className="w-9 text-xs text-muted">{row.unit}</span>
            </label>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 mobile:grid-cols-1">
        <Field label="Usual portion" htmlFor={`${id}-dq`} hint="Where the portion starts until you've logged it a few times.">
          <div className="flex gap-2">
            <input id={`${id}-dq`} inputMode="decimal" value={draft.defaultQty} onChange={(e) => set('defaultQty', e.target.value)} className={`${inputCls} w-20 font-mono`} />
            <select aria-label="Usual portion unit" value={canonicalUnit(draft.defaultUnit)} onChange={(e) => set('defaultUnit', e.target.value)} className={`${inputCls} flex-auto`}>
              {[...new Set([canonicalUnit(draft.defaultUnit), ...portionUnits])].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label={<>Also find it as <span className="font-normal">· helps “log with words”</span></>} htmlFor={`${id}-al`}>
          <input id={`${id}-al`} value={draft.aliases} placeholder="greek yogurt, skyr" onChange={(e) => set('aliases', e.target.value)} className={inputCls} />
        </Field>
        <Field label={<>Barcode <span className="font-normal">· optional</span></>} htmlFor={`${id}-bc`}>
          <input id={`${id}-bc`} inputMode="numeric" value={draft.barcodes} placeholder="Scan or type" onChange={(e) => set('barcodes', e.target.value)} className={`${inputCls} font-mono ${flagCls('barcode')}`} />
        </Field>
        <Field label={<>Notes <span className="font-normal">· optional</span></>} htmlFor={`${id}-no`}>
          <input id={`${id}-no`} value={draft.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
        </Field>
      </div>
    </div>
  );
}

/** A one-line preview of what the usual portion comes to. */
export function DraftPreview({ draft }: { draft: FoodDraft }) {
  const parsed = useMemo(() => draftToInput(draft), [draft]);
  if ('error' in parsed) return null;
  const p = computePortion(parsed.input, parsed.input.defaultPortion.quantity, parsed.input.defaultPortion.unit);
  if (!p) return null;
  return (
    <span className="text-[13px] text-muted">
      Usual portion: <strong className="font-mono text-ink">{fmtKcal(p.nutrients.kcal)}</strong> kcal
    </span>
  );
}

/** The photos a food was read from, to check values against later. */
export function FoodPhotos({ food }: { food: Food }) {
  const urls = useFoodImages(food.id, food.images.length > 0);
  if (!food.images.length) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {urls.data?.map((img) => (
        <a key={img.key} href={img.url} target="_blank" rel="noreferrer" className="block">
          <img src={img.url} alt={`${img.kind} photo`} className="h-24 w-auto max-w-[160px] rounded-lg border border-line object-contain" />
        </a>
      ))}
      {urls.isPending && <span className="text-xs text-muted">Loading photos…</span>}
    </div>
  );
}

/**
 * The food form in a dialog: new (manual / reviewed from a source) or editing one of the user's
 * foods. `onSaved(food, log)` — `log` when they chose "Save & log".
 */
export function FoodFormDialog({
  title,
  initial,
  editing,
  flags,
  banner,
  onClose,
  onSaved,
  saveAndLog = true,
}: {
  title: string;
  initial: FoodDraft;
  /** Set when editing an existing food. */
  editing?: Food | undefined;
  flags?: ReadonlySet<string> | undefined;
  banner?: ReactNode;
  onClose: () => void;
  onSaved: (food: Food, log: boolean) => void;
  saveAndLog?: boolean;
}) {
  const m = useFoodMutations();
  const [draft, setDraft] = useState(initial);
  const [checks, setChecks] = useState<ReadonlySet<string> | undefined>(flags);
  const [tab, setTab] = useState<'details' | 'ai'>('details');
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const busy = m.createFood.isPending || m.updateFood.isPending;
  // Something has to be there to adjust. Stays once open, so clearing the value doesn't drop the tab.
  const canAdjust = !!draft.nutrients.kcal?.trim() || tab === 'ai';

  const save = (log: boolean) => {
    const parsed = draftToInput(draft);
    if ('error' in parsed) return setError(parsed.error);
    setError(null);
    const done = (f: Food) => onSaved(f, log);
    const fail = (e: unknown) => setError(errorMessage(e));
    if (editing) {
      const { source: _s, sourceRef: _r, ...patch } = parsed.input;
      const unset = (['brand', 'servingLabel', 'notes'] as const).filter((k) => patch[k] == null && editing[k] != null);
      m.updateFood.mutate({ id: editing.id, patch: { ...patch, ...(unset.length ? { unset: [...unset] } : {}) } }, { onSuccess: done, onError: fail });
    } else m.createFood.mutate(parsed.input, { onSuccess: done, onError: fail });
  };

  return (
    <Dialog
      title={title}
      width={760}
      tall
      onClose={onClose}
      header={
        editing || canAdjust ? (
          <div className="flex flex-col gap-2">
            {editing && <div className="text-xs text-muted">{SOURCE_LINE[editing.source]}</div>}
            {canAdjust && (
              <Segmented
                label="Edit by hand or with AI"
                value={tab}
                onChange={setTab}
                options={[
                  { key: 'details', label: 'Details' },
                  { key: 'ai', label: 'Adjust with AI' },
                ]}
              />
            )}
          </div>
        ) : undefined
      }
      footer={
        <div className="flex flex-col gap-2">
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            <DraftPreview draft={draft} />
            <span className="grow" />
            {editing &&
              (confirmArchive ? (
                <>
                  <span className="text-[13px] text-muted">Remove from your foods? Past logs keep it.</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(false)}>
                    Keep
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => m.archiveFood.mutate(editing.id, { onSuccess: onClose, onError: (e) => setError(errorMessage(e)) })}>
                    Remove
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" aria-label="Remove food" onClick={() => setConfirmArchive(true)}>
                  <TrashIcon />
                </Button>
              ))}
            {!confirmArchive && (
              <>
                <Button variant={saveAndLog ? 'secondary' : 'primary'} disabled={busy} onClick={() => save(false)}>
                  {editing ? 'Save changes' : 'Save to my foods'}
                </Button>
                {saveAndLog && !editing && (
                  <Button variant="primary" disabled={busy} onClick={() => save(true)}>
                    Save &amp; log
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      }
    >
      {banner}
      {editing && <FoodPhotos food={editing} />}
      {/* Both stay mounted, so switching tabs keeps the conversation and anything half typed. */}
      <div hidden={tab !== 'details'}>
        <FoodForm draft={draft} onChange={setDraft} flags={checks} />
      </div>
      <div hidden={tab !== 'ai'}>
        <AdjustWithAi
          draft={draft}
          onApply={(adjustment) => {
            const next = withAdjustment(draft, adjustment);
            setDraft(next.draft);
            setChecks(new Set([...(checks ?? []), ...next.changed]));
          }}
        />
      </div>
    </Dialog>
  );
}
