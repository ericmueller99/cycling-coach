import { formatShortDate, wattsPerKg, zwiftCategoryTable, zwiftWeightDrift, type ZwiftCategoryRow } from '@cycling-coach/core';
import type { Profile, ZwiftCategory } from '@cycling-coach/shared';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from '../../components/icons';
import { Button, Card, ProgressBar } from '../../components/ui';
import { ZwiftWeightAlert } from '../../components/ZwiftWeightAlert';
import { useIsMobile } from '../../lib/useIsMobile';
import { categoryBadge, ZWIFT_CATEGORY_COLORS } from '../../lib/zwiftColors';
import { Tile } from './shared';

/** Phones fold the watts under the rule; wider screens give them a column. */
const CATEGORY_GRID = 'grid grid-cols-[44px_minmax(0,1fr)_96px] sm:grid-cols-[56px_minmax(0,1.6fr)_minmax(0,1fr)_150px]';

/**
 * Badges always wear Zwift's colour for their category; the row's state shows in a tint of that
 * colour (current, closest) and in the status text (DECISIONS #115).
 */
function rowStyle(r: ZwiftCategoryRow): { row: CSSProperties; status: CSSProperties; statusClass: string } {
  const c = ZWIFT_CATEGORY_COLORS[r.category];
  switch (r.state) {
    case 'current':
      return { row: { background: c.tint }, status: {}, statusClass: 'text-ink' };
    case 'closest':
      return { row: { background: c.tint }, status: { color: c.ink }, statusClass: '' };
    case 'above':
      return { row: {}, status: {}, statusClass: 'text-muted' };
    case 'met':
      return { row: {}, status: {}, statusClass: 'text-success' };
  }
}

const gapLabel = (gap: ZwiftCategoryRow['gap']) => (gap ? `+${gap.watts} W ${gap.metric === 'zftp' ? 'zFTP' : 'zMAP'}` : '—');

function rowStatus(r: ZwiftCategoryRow) {
  if (r.state === 'current') return 'You are here';
  if (r.state === 'met') return 'Met';
  return r.state === 'closest' ? `Closest · ${gapLabel(r.gap)}` : gapLabel(r.gap);
}

function GapBar({ label, have, need, color }: { label: string; have: number; need: number; color: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
      <span className="w-[38px] flex-none">{label}</span>
      <div className="h-1.5 flex-auto overflow-hidden rounded-[3px] bg-track">
        <div className="h-full" style={{ width: `${Math.min(100, Math.round((have / need) * 100))}%`, background: color }} />
      </div>
      <span className="w-[76px] flex-none text-right">
        {have} / {need} W
      </span>
    </div>
  );
}

/**
 * Where zFTP/zMAP put the rider in Zwift's pace categories, what the next one up takes, and the
 * full rule table at the Zwift weight. The badge prefers Zwift's own category.
 */
function PaceCategoryPanel({ zftp, zmap, weightKg, shownCategory, asOf, zwiftWeight }: {
  zftp: number | undefined;
  zmap: number | undefined;
  weightKg: number;
  shownCategory: ZwiftCategory | undefined;
  asOf: string | undefined;
  zwiftWeight: boolean;
}) {
  const rows = zwiftCategoryTable({ zftp, zmap, weightKg });
  if (!rows) return null;
  const category = shownCategory ?? rows.find((r) => r.state === 'current')!.category;
  const closest = rows.find((r) => r.state === 'closest');
  const routes = closest
    ? [
        zftp !== undefined && closest.zftpWatts ? `${closest.zftpWatts - zftp} W more zFTP (${closest.zftpWatts} W)` : '',
        zmap !== undefined && closest.zmapWatts ? `${closest.zmapWatts - zmap} W more zMAP (${closest.zmapWatts} W)` : '',
      ].filter(Boolean)
    : [];

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-4 border-b border-line bg-surface-alt px-4 py-3.5">
        <div className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-xl text-[26px] font-bold" style={categoryBadge(category)}>
          {category}
        </div>
        <div className="flex-[1_1_200px]">
          <div className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Current pace category</div>
          <div className="font-semibold">
            Category {category}
            {asOf ? ` · as of ${formatShortDate(asOf)}` : ''}
          </div>
        </div>
        <div className="flex flex-[1_1_260px] flex-col gap-1.5">
          {closest ? (
            <>
              <div className="text-[13px]">
                <span className="font-semibold" style={{ color: ZWIFT_CATEGORY_COLORS[closest.category].ink }}>
                  Closest: {closest.category}
                </span>{' '}
                — {routes.join(', or ') || 'add zFTP or zMAP'}
              </div>
              <div className="flex flex-col gap-1">
                {zftp !== undefined && closest.zftpWatts && <GapBar label="zFTP" have={zftp} need={closest.zftpWatts} color={ZWIFT_CATEGORY_COLORS[closest.category].bg} />}
                {zmap !== undefined && closest.zmapWatts && <GapBar label="zMAP" have={zmap} need={closest.zmapWatts} color="#A3AAB6" />}
              </div>
            </>
          ) : (
            <div className="text-[13px] font-semibold text-accent-ink">Top category on zFTP</div>
          )}
        </div>
      </div>
      <div className={`${CATEGORY_GRID} border-b border-divider px-4 py-2 text-xs font-semibold tracking-[0.05em] text-muted uppercase`}>
        <div>Cat</div>
        <div>Rule</div>
        <div className="hidden sm:block">At {weightKg} kg</div>
        <div className="text-right">You</div>
      </div>
      {rows.map((r) => {
        const style = rowStyle(r);
        const watts = r.zftpWatts ? [r.zmapWatts ? `${r.zmapWatts} W zMAP` : '', `${r.zftpWatts} W zFTP`].filter(Boolean).join(' · ') : '—';
        return (
          <div key={r.category} className={`${CATEGORY_GRID} items-center gap-x-2 border-b border-divider bg-surface px-4 py-2.5`} style={style.row}>
            <div>
              <span className="inline-flex h-[26px] min-w-[30px] items-center justify-center rounded-[7px] px-1.5 text-[13px] font-bold" style={categoryBadge(r.category)}>
                {r.category}
              </span>
            </div>
            <div className="text-[13px]">
              {r.rule}
              {r.zftpWatts && <div className="font-mono text-[11px] text-muted sm:hidden">{watts}</div>}
            </div>
            <div className="hidden font-mono text-xs text-muted sm:block">{watts}</div>
            <div className={`text-right text-xs font-semibold ${style.statusClass}`} style={style.status}>
              {rowStatus(r)}
            </div>
          </div>
        );
      })}
      <div className="px-4 py-2.5 text-xs text-muted">
        Zwift assigns categories from your modeled zFTP and zMAP. Thresholds use your {zwiftWeight ? 'Zwift' : 'trend'} weight.
      </div>
    </div>
  );
}

/** Mobile pace-category header: badge, the nearest way up, and how close it is. */
function CategorySummary({ rows, shown, zftp, zmap }: { rows: ZwiftCategoryRow[]; shown: ZwiftCategory | undefined; zftp: number | undefined; zmap: number | undefined }) {
  const category = shown ?? rows.find((r) => r.state === 'current')!.category;
  const closest = rows.find((r) => r.state === 'closest');
  const gap = closest?.gap;
  const need = gap && (gap.metric === 'zftp' ? closest.zftpWatts : closest.zmapWatts);
  const have = gap && (gap.metric === 'zftp' ? zftp : zmap);
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
      <div className="flex h-[48px] w-[48px] flex-none items-center justify-center rounded-xl text-[24px] font-bold" style={categoryBadge(category)}>
        {category}
      </div>
      <div className="min-w-0 flex-auto">
        <div className="font-semibold">Category {category}</div>
        {closest && gap && need ? (
          <>
            <div className="text-[13px]">
              <span className="font-semibold" style={{ color: ZWIFT_CATEGORY_COLORS[closest.category].ink }}>
                {closest.category}
              </span>{' '}
              is {gap.watts} W more {gap.metric === 'zftp' ? 'zFTP' : 'zMAP'} ({need} W)
            </div>
            {have !== undefined && <ProgressBar value={have / need} height={6} color={ZWIFT_CATEGORY_COLORS[closest.category].bg} />}
          </>
        ) : (
          <div className="text-[13px] font-semibold text-accent-ink">Top category on zFTP</div>
        )}
      </div>
    </div>
  );
}

/**
 * Zwift's own race metrics and weight (DECISIONS #23), synced from Zwift — read-only here.
 * zFTP/zMAP on the Zwift weight set the category Zwift Racing League uses.
 */
export function ZwiftSection({ profile }: { profile: Profile }) {
  const z = profile.zwift;
  const zwiftSynced = z?.source === 'zwift';
  const kg = profile.zwiftWeightKg ?? profile.weightKg;
  const drifting = zwiftWeightDrift(profile.zwiftWeightKg, profile.weightKg) !== null;

  const mobile = useIsMobile();
  const [rulesOpen, setRulesOpen] = useState(false);

  if (mobile) {
    // Read-only tiles of the synced numbers.
    const savedWkg = (w: number | undefined) => (w ? wattsPerKg(w, kg).toFixed(2) : '');
    const rows = zwiftCategoryTable({ zftp: z?.zftp, zmap: z?.zmap, weightKg: kg });
    const tile = (label: string, value: ReactNode, warn = false) => (
      <div className={`rounded-[10px] border p-2.5 ${warn ? 'border-[#E9B98A]' : 'border-line'}`}>
        <div className="text-xs text-muted">{label}</div>
        <div className="font-mono font-semibold">{value}</div>
      </div>
    );
    return (
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="m-0 text-[16px]">Zwift</h2>
        {rows && <CategorySummary rows={rows} shown={z?.category} zftp={z?.zftp} zmap={z?.zmap} />}
        <div className="grid grid-cols-2 gap-2">
          {tile('zFTP', z?.zftp ? <>{z.zftp} W <span className="text-[11px] text-muted">{savedWkg(z.zftp)}</span></> : '—')}
          {tile('zMAP', z?.zmap ? <>{z.zmap} W <span className="text-[11px] text-muted">{savedWkg(z.zmap)}</span></> : '—')}
          {tile('Zwift weight', profile.zwiftWeightKg ? `${profile.zwiftWeightKg} kg` : '—', drifting)}
          {tile('Racing Score', z?.racingScore ?? '—')}
        </div>
        <ZwiftWeightAlert zwiftKg={profile.zwiftWeightKg} trendKg={profile.weightKg} zftp={z?.zftp} synced={zwiftSynced} />
        {rows && (
          <>
            <Button size="lg" variant="ghost" aria-expanded={rulesOpen} onClick={() => setRulesOpen((o) => !o)}>
              Category rules
              <ChevronDown className={rulesOpen ? 'rotate-180' : ''} />
            </Button>
            {rulesOpen && (
              <div className="flex flex-col overflow-hidden rounded-[10px] border border-line">
                {rows.map((r) => {
                  const style = rowStyle(r);
                  return (
                    <div key={r.category} className="flex gap-2.5 border-b border-divider bg-surface px-3 py-2.5 last:border-0" style={style.row}>
                      <span className="flex h-[24px] w-[30px] flex-none items-center justify-center rounded-md text-xs font-bold" style={categoryBadge(r.category)}>
                        {r.category}
                      </span>
                      <div className="min-w-0 flex-auto">
                        <div className="text-[13px]">{r.rule}</div>
                        <div className={`text-xs font-semibold ${style.statusClass}`} style={style.status}>
                          {rowStatus(r)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="px-3 py-2 text-xs text-muted">Zwift assigns categories from your modeled zFTP and zMAP. Thresholds use your Zwift weight.</div>
              </div>
            )}
          </>
        )}
      </Card>
    );
  }

  const wkg = (w: number | undefined) => (w ? `${wattsPerKg(w, kg).toFixed(2)} W/kg` : '');
  const watts = (w: number | undefined) => (
    <>
      <span className="font-mono text-base font-semibold text-ink">{w ? `${w} W` : '—'}</span>
      <span className="font-mono text-xs text-muted">{wkg(w)}</span>
    </>
  );
  return (
    <Card className="flex flex-col gap-4 p-[18px]">
      <h2 className="m-0 text-base">Zwift</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="zFTP" title="Zwift's estimated FTP from your rides and races">
          {watts(z?.zftp)}
        </Tile>
        <Tile label="zMAP" title="Zwift's estimated max aerobic power">
          {watts(z?.zmap)}
        </Tile>
        <Tile label="Zwift weight" title="The weight set in Zwift — race categories use it" className={drifting ? 'border border-[#E9B98A] bg-surface-2' : 'bg-surface-2'}>
          <span className="font-mono text-base font-semibold text-ink">{profile.zwiftWeightKg ? `${profile.zwiftWeightKg} kg` : '—'}</span>
          <span className="text-xs text-muted">{profile.zwiftWeightKg ? (zwiftSynced ? 'synced from Zwift' : 'your Zwift baseline') : `not set — trend ${profile.weightKg} kg used`}</span>
        </Tile>
        <Tile label="Racing Score" title="From race results — shown for context, not a training target">
          <span className="font-mono text-base font-semibold text-ink">{z?.racingScore ?? '—'}</span>
          <span className="text-xs text-muted">results-based</span>
        </Tile>
      </div>
      <ZwiftWeightAlert zwiftKg={profile.zwiftWeightKg} trendKg={profile.weightKg} zftp={z?.zftp} synced={zwiftSynced} />
      <PaceCategoryPanel zftp={z?.zftp} zmap={z?.zmap} weightKg={kg} shownCategory={z?.category} asOf={z?.asOf} zwiftWeight={profile.zwiftWeightKg !== undefined} />
      <div className="text-xs text-muted">
        {z
          ? z.source === 'zwift'
            ? `Synced from Zwift · as of ${formatShortDate(z.asOf)}.`
            : `Entered by hand · ${formatShortDate(z.asOf)}.`
          : 'Synced from Zwift when the server has your Zwift login.'}
      </div>
    </Card>
  );
}
