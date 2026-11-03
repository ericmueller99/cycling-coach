import type { ZwiftCategory } from '@cycling-coach/shared';
import { wattsPerKg } from './zones';

/**
 * Zwift's zFTP/zMAP category enforcement, which Zwift Racing League still uses: crossing either
 * the zFTP line (W/kg and a watts floor) or the zMAP line puts you in that category. A+ has no
 * zMAP route. Source: zwiftinsider.com/category-enforcement (zMAP limits as of 2023-06-09).
 */
export const ZWIFT_CATEGORY_THRESHOLDS = [
  { category: 'A+', zftpWkg: 4.6, zftpMinW: 300, rule: 'zFTP ≥ 4.6 W/kg and ≥ 300 W' },
  { category: 'A', zftpWkg: 4.2, zftpMinW: 250, zmapWkg: 5.1, rule: 'zMAP ≥ 5.1 W/kg, or zFTP ≥ 4.2 W/kg and ≥ 250 W' },
  { category: 'B', zftpWkg: 3.36, zftpMinW: 200, zmapWkg: 4.1, rule: 'zMAP ≥ 4.1 W/kg, or zFTP ≥ 3.36 W/kg and ≥ 200 W' },
  { category: 'C', zftpWkg: 2.625, zftpMinW: 150, zmapWkg: 3.2, rule: 'zMAP ≥ 3.2 W/kg, or zFTP ≥ 2.625 W/kg and ≥ 150 W' },
] as const satisfies readonly { category: ZwiftCategory; zftpWkg: number; zftpMinW: number; zmapWkg?: number; rule: string }[];

type Threshold = (typeof ZWIFT_CATEGORY_THRESHOLDS)[number];
type ZwiftMeasures = { zftp?: number | undefined; zmap?: number | undefined; weightKg: number };

/** Whole watts for a W/kg line; rounded first so 4.2 × 80 isn't 336.0000001 → 337. */
const wattsAt = (wkg: number, kg: number) => Math.ceil(Number((wkg * kg).toFixed(6)));

function linesAt(t: Threshold, kg: number) {
  return {
    zftpWatts: Math.max(t.zftpMinW, wattsAt(t.zftpWkg, kg)),
    zmapWatts: 'zmapWkg' in t ? wattsAt(t.zmapWkg, kg) : undefined,
  };
}

/** Index into ZWIFT_CATEGORY_THRESHOLDS of the highest category met; -1 is D. */
function categoryIndex(m: ZwiftMeasures) {
  return ZWIFT_CATEGORY_THRESHOLDS.findIndex((t) => {
    const lines = linesAt(t, m.weightKg);
    return (m.zftp !== undefined && m.zftp >= lines.zftpWatts) || (m.zmap !== undefined && lines.zmapWatts !== undefined && m.zmap >= lines.zmapWatts);
  });
}

export interface ZwiftCategoryStatus {
  category: Exclude<ZwiftCategory, 'E'>;
  zftpWkg?: number | undefined;
  zmapWkg?: number | undefined;
  /** What the next category up takes at this weight; absent in A+. A+ has no zMAP route. */
  nextUp?:
    | { category: ZwiftCategory; zftpWkg: number; zftpWatts: number; zmapWkg?: number | undefined; zmapWatts?: number | undefined }
    | undefined;
}

/** The category zFTP/zMAP put a rider in at `weightKg`, and the watts for the next one up. */
export function zwiftCategory(m: ZwiftMeasures): ZwiftCategoryStatus | undefined {
  if (!m.zftp && !m.zmap) return undefined;
  const index = categoryIndex(m);
  const category = index === -1 ? 'D' : ZWIFT_CATEGORY_THRESHOLDS[index]!.category;
  const next = index === -1 ? ZWIFT_CATEGORY_THRESHOLDS[ZWIFT_CATEGORY_THRESHOLDS.length - 1]! : ZWIFT_CATEGORY_THRESHOLDS[index - 1];
  const nextLines = next && linesAt(next, m.weightKg);
  return {
    category,
    zftpWkg: m.zftp ? wattsPerKg(m.zftp, m.weightKg) : undefined,
    zmapWkg: m.zmap ? wattsPerKg(m.zmap, m.weightKg) : undefined,
    nextUp: next && {
      category: next.category,
      zftpWkg: next.zftpWkg,
      zftpWatts: nextLines!.zftpWatts,
      ...('zmapWkg' in next ? { zmapWkg: next.zmapWkg, zmapWatts: nextLines!.zmapWatts } : {}),
    },
  };
}

export interface ZwiftCategoryRow {
  category: Exclude<ZwiftCategory, 'E'>;
  rule: string;
  /** The lines at this weight; absent for D. */
  zftpWatts?: number | undefined;
  zmapWatts?: number | undefined;
  /** `closest` is the category directly above the current one. */
  state: 'current' | 'closest' | 'above' | 'met';
  /** For categories above: the smaller shortfall, on whichever metric is known. */
  gap?: { watts: number; metric: 'zftp' | 'zmap' } | undefined;
}

/** Every category A+…D with its lines at `weightKg` and where the rider stands against each. */
export function zwiftCategoryTable(m: ZwiftMeasures): ZwiftCategoryRow[] | undefined {
  if (!m.zftp && !m.zmap) return undefined;
  const index = categoryIndex(m);
  const current = index === -1 ? ZWIFT_CATEGORY_THRESHOLDS.length : index;
  const state = (i: number): ZwiftCategoryRow['state'] => (i === current ? 'current' : i === current - 1 ? 'closest' : i < current ? 'above' : 'met');
  const rows: ZwiftCategoryRow[] = ZWIFT_CATEGORY_THRESHOLDS.map((t, i) => {
    const lines = linesAt(t, m.weightKg);
    const gaps = [
      m.zftp !== undefined ? { watts: lines.zftpWatts - m.zftp, metric: 'zftp' as const } : undefined,
      m.zmap !== undefined && lines.zmapWatts !== undefined ? { watts: lines.zmapWatts - m.zmap, metric: 'zmap' as const } : undefined,
    ].filter((g) => g !== undefined);
    const gap = i < current ? gaps.reduce<(typeof gaps)[number] | undefined>((best, g) => (!best || g.watts < best.watts ? g : best), undefined) : undefined;
    return { category: t.category, rule: t.rule, ...lines, state: state(i), ...(gap ? { gap } : {}) };
  });
  return [...rows, { category: 'D', rule: 'Below C', state: state(ZWIFT_CATEGORY_THRESHOLDS.length) }];
}
