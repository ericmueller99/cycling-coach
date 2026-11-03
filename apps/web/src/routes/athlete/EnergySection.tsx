import { fatFreeMass, formatShortDate, katchMcArdle } from '@cycling-coach/core';
import { bmrSources, type BmrSource, type BodyScan, type BodyScanInput, type EnergyPatch, type EnergySettings } from '@cycling-coach/shared';
import { useEffect, useId, useState } from 'react';
import { PencilIcon, TrashIcon } from '../../components/icons';
import { Button, Card, ErrorNote, Spinner, StatTile, inputCls } from '../../components/ui';
import { fmtKcal } from '../../lib/food';
import { useEnergy, useEnergyMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';

/** `measured` means a lab test (breath analysis); a number printed on a scan report is `scan` (DECISIONS #38). */
const SOURCE_LABEL: Record<BmrSource, string> = {
  measured: 'Measured (lab test)',
  scan: 'From a body scan',
  formula: 'Formula estimate',
  other: 'Other',
};

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
const str = (n: number | undefined) => (n == null ? '' : String(n));

interface BmrDraft {
  bmr: string;
  source: BmrSource | '';
  date: string;
  note: string;
}
const bmrDraft = (s: EnergySettings): BmrDraft => ({ bmr: str(s.bmrKcal), source: s.bmrSource ?? '', date: s.bmrDate ?? '', note: s.bmrNote ?? '' });

/** Draft → patch: set what's filled, unset what was cleared. */
function bmrPatch(d: BmrDraft, s: EnergySettings): EnergyPatch | { error: string } {
  const bmr = num(d.bmr);
  if (bmr != null && !(Number.isInteger(bmr) && bmr >= 500 && bmr <= 5000)) return { error: 'RMR should be a whole number of kcal per day (500–5000).' };
  const unset: NonNullable<EnergyPatch['unset']> = [];
  if (bmr == null && s.bmrKcal != null) unset.push('bmrKcal');
  if (!d.source && s.bmrSource) unset.push('bmrSource');
  if (!d.date && s.bmrDate) unset.push('bmrDate');
  if (!d.note.trim() && s.bmrNote) unset.push('bmrNote');
  return {
    ...(bmr != null ? { bmrKcal: bmr } : {}),
    ...(d.source ? { bmrSource: d.source } : {}),
    ...(d.date ? { bmrDate: d.date } : {}),
    ...(d.note.trim() ? { bmrNote: d.note.trim() } : {}),
    ...(unset.length ? { unset } : {}),
  };
}

interface ScanDraft {
  date: string;
  weightKg: string;
  bodyFatPct: string;
  leanMassKg: string;
  boneMineralKg: string;
  fatFreeMassKg: string;
  rmrKcal: string;
  note: string;
}
const scanDraft = (s?: BodyScan, today = ''): ScanDraft => ({
  date: s?.date ?? today,
  weightKg: str(s?.weightKg),
  bodyFatPct: str(s?.bodyFatPct),
  leanMassKg: str(s?.leanMassKg),
  boneMineralKg: str(s?.boneMineralKg),
  fatFreeMassKg: str(s?.fatFreeMassKg),
  rmrKcal: str(s?.rmrKcal),
  note: s?.note ?? '',
});

function scanInput(d: ScanDraft): BodyScanInput | { error: string } {
  const weightKg = num(d.weightKg);
  const bodyFatPct = num(d.bodyFatPct);
  if (!d.date) return { error: 'Add the scan date.' };
  if (!weightKg || !bodyFatPct) return { error: 'Weight and body fat % are needed.' };
  const opt = (k: 'leanMassKg' | 'boneMineralKg' | 'fatFreeMassKg' | 'rmrKcal') => {
    const v = num(d[k]);
    return v != null && Number.isFinite(v) ? { [k]: k === 'rmrKcal' ? Math.round(v) : v } : {};
  };
  return {
    date: d.date,
    weightKg,
    bodyFatPct,
    ...opt('leanMassKg'),
    ...opt('boneMineralKg'),
    ...opt('fatFreeMassKg'),
    ...opt('rmrKcal'),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
  };
}

function ScanForm({ initial, onCancel, onSave, busy }: { initial: ScanDraft; onCancel: () => void; onSave: (input: BodyScanInput) => void; busy: boolean }) {
  const id = useId();
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const field = (k: keyof ScanDraft, label: string, unit?: string, type = 'number') => (
    <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${id}-${k}`}>
      {label}
      <span className="flex items-center gap-1.5">
        <input id={`${id}-${k}`} type={type} inputMode={type === 'number' ? 'decimal' : undefined} step="any" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} className={`${inputCls} w-full font-mono`} />
        {unit && <span className="text-xs">{unit}</span>}
      </span>
    </label>
  );
  const ffm = (() => {
    const parsed = scanInput(d);
    return 'error' in parsed ? null : fatFreeMass(parsed);
  })();
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface-2 p-3.5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {field('date', 'Scan date', undefined, 'date')}
        {field('weightKg', 'Weight', 'kg')}
        {field('bodyFatPct', 'Body fat (total body)', '%')}
        {field('leanMassKg', 'Lean mass', 'kg')}
        {field('boneMineralKg', 'Bone mineral (BMC)', 'kg')}
        {field('fatFreeMassKg', 'Fat-free mass', 'kg')}
        {field('rmrKcal', 'RMR printed on report', 'kcal')}
        {field('note', 'Note', undefined, 'text')}
      </div>
      <div className="text-xs text-muted">
        Enter grams as kg (70,124 g → 70.1). Fat-free mass = lean + BMC, worked out for you when left blank{ffm != null ? ` — ${ffm} kg here` : ''}. Body fat is fat ÷ total mass.
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => {
            const parsed = scanInput(d);
            if ('error' in parsed) return setError(parsed.error);
            onSave(parsed);
          }}
        >
          Save scan
        </Button>
      </div>
    </div>
  );
}

/**
 * RMR & body composition (Athlete › Body & energy). RMR (stored as `bmrKcal`) is what the calorie
 * budget starts from; scans keep their history. A scan's printed RMR is the default; Katch-McArdle on
 * fat-free mass is the alternative (DECISIONS #38).
 */
export function EnergySection({ today }: { today: string }) {
  const id = useId();
  const energy = useEnergy();
  const m = useEnergyMutations();
  const settings = energy.data?.settings;
  const [draft, setDraft] = useState<BmrDraft>({ bmr: '', source: '', date: '', note: '' });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (settings) setDraft(bmrDraft(settings));
  }, [settings]);

  if (energy.isPending) return <Spinner />;
  if (energy.error || !energy.data || !settings) return <ErrorNote>{errorMessage(energy.error)}</ErrorNote>;
  const scans = energy.data.scans;
  const latest = scans[0];
  const saved = bmrDraft(settings);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const fail = (e: unknown) => setError(errorMessage(e));

  const save = () => {
    const patch = bmrPatch(draft, settings);
    if ('error' in patch) return setError(patch.error);
    setError(null);
    m.patch.mutate(patch, { onError: fail });
  };

  const applyScan = (scan: BodyScan, kcal: number, how: string) =>
    setDraft({ bmr: String(kcal), source: 'scan', date: scan.date, note: `${how} · scan ${formatShortDate(scan.date)}` });

  return (
    <Card className="flex flex-col gap-4 p-[18px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-base">RMR & body composition</h2>
        <Button variant={dirty ? 'primary' : 'neutral'} size="sm" disabled={!dirty || m.patch.isPending} onClick={save}>
          {m.patch.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>

      {settings.bmrKcal != null && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[12px] bg-accent-tint px-3.5 py-3">
          <span className="font-mono text-[26px] leading-none font-semibold">{fmtKcal(settings.bmrKcal)}</span>
          <span className="text-[13px] text-muted">kcal/day at rest</span>
          <span className="basis-full text-xs text-muted">
            {[settings.bmrSource ? SOURCE_LABEL[settings.bmrSource] : '', settings.bmrDate ? formatShortDate(settings.bmrDate) : '', settings.bmrNote ?? ''].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2.5 sm:grid-cols-[120px_minmax(0,1fr)_150px]">
        <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${id}-bmr`}>
          RMR (kcal/day)
          <input id={`${id}-bmr`} type="number" inputMode="numeric" value={draft.bmr} placeholder="e.g. 1850" onChange={(e) => setDraft({ ...draft, bmr: e.target.value })} className={`${inputCls} font-mono text-[15px]`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${id}-src`}>
          Where it's from
          <select id={`${id}-src`} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as BmrSource | '' })} className={inputCls}>
            <option value="">—</option>
            {bmrSources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-1" htmlFor={`${id}-date`}>
          As of
          <input id={`${id}-date`} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputCls} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${id}-note`}>
        Note
        <input id={`${id}-note`} value={draft.note} placeholder="e.g. RMR from the May DEXA report" onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={inputCls} />
      </label>
      <div className="-mt-1 text-xs text-muted">Resting metabolic rate (also called BMR): what you burn at rest. Your budget starts here; steps and rides are added on top.</div>

      <div className="flex flex-col gap-2.5 border-t border-divider pt-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">{latest ? `Latest scan · ${formatShortDate(latest.date)}` : 'Body scans'}</span>
          {!adding && (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              + Add scan
            </Button>
          )}
        </div>
        {adding && (
          <ScanForm
            initial={scanDraft(undefined, today)}
            busy={m.addScan.isPending}
            onCancel={() => setAdding(false)}
            onSave={(input) => m.addScan.mutate(input, { onSuccess: () => setAdding(false), onError: fail })}
          />
        )}
        {latest ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Body fat" value={latest.bodyFatPct} unit="%" />
              <StatTile label="Lean mass" value={latest.leanMassKg ?? '—'} unit={latest.leanMassKg ? 'kg' : ''} />
              <StatTile label="Fat-free mass" value={fatFreeMass(latest)} unit="kg" />
              <StatTile label="Weight" value={latest.weightKg} unit="kg" />
            </div>
            <div className="flex flex-wrap gap-2">
              {latest.rmrKcal && (
                <Button size="sm" variant="primary" onClick={() => applyScan(latest, latest.rmrKcal!, "Scan report's RMR")}>
                  Use the scan's RMR · {fmtKcal(latest.rmrKcal)} kcal
                </Button>
              )}
              <Button size="sm" variant={latest.rmrKcal ? 'ghost' : 'primary'} onClick={() => applyScan(latest, katchMcArdle(fatFreeMass(latest)), 'Katch-McArdle')}>
                {latest.rmrKcal ? 'Katch-McArdle instead' : 'Calculate from this scan'} · {fmtKcal(katchMcArdle(fatFreeMass(latest)))} kcal
              </Button>
            </div>
            <div className="text-xs text-muted">
              {latest.rmrKcal ? "The report's RMR is worked out from your fat-free mass. " : ''}Katch-McArdle (370 + 21.6 × fat-free mass) uses lean mass too. Both are estimates; then Save.
            </div>
          </>
        ) : (
          !adding && <div className="text-[13px] text-muted">Add a DEXA or other body-composition scan to get your RMR from your lean mass.</div>
        )}
        {scans.length > 0 && (
          <div className="flex flex-col">
            {scans.map((s) =>
              editing === s.id ? (
                <ScanForm
                  key={s.id}
                  initial={scanDraft(s)}
                  busy={m.updateScan.isPending}
                  onCancel={() => setEditing(null)}
                  onSave={(input) => {
                    const unset = (['leanMassKg', 'boneMineralKg', 'fatFreeMassKg', 'rmrKcal', 'note'] as const).filter((k) => input[k] == null && s[k] != null);
                    m.updateScan.mutate({ id: s.id, patch: { ...input, ...(unset.length ? { unset: [...unset] } : {}) } }, { onSuccess: () => setEditing(null), onError: fail });
                  }}
                />
              ) : (
                <div key={s.id} className="flex min-h-10 items-center gap-3 border-b border-divider text-[13px] last:border-b-0">
                  <span className="w-14 font-mono">{formatShortDate(s.date)}</span>
                  <span className="flex-auto font-mono text-muted">
                    {s.weightKg} kg · {s.bodyFatPct}% · FFM {fatFreeMass(s)} kg{s.rmrKcal ? ` · RMR ${fmtKcal(s.rmrKcal)}` : ''}
                  </span>
                  {settings.bmrSource === 'scan' && settings.bmrDate === s.date && (
                    <span className="rounded-md bg-accent-tint-2 px-1.5 py-0.5 text-[11px] font-semibold text-accent-ink">In use</span>
                  )}
                  <button type="button" aria-label={`Edit scan ${s.date}`} onClick={() => setEditing(s.id)} className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-2">
                    <PencilIcon />
                  </button>
                  <button type="button" aria-label={`Delete scan ${s.date}`} onClick={() => m.deleteScan.mutate(s.id, { onError: fail })} className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-2">
                    <TrashIcon />
                  </button>
                </div>
              ),
            )}
          </div>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}
