import { zwiftCategories, type ZwiftCategory } from '@cycling-coach/shared';

/**
 * Zwift's unofficial game API → what we keep (DECISIONS #23). Pure, so it's fixture-tested. Every
 * field is optional: a missing one leaves the stored value alone rather than failing the sync.
 * Field names follow Sauce4Zwift (src/zwift.mjs) and zwift-api-wrapper (src/types.ts).
 */
export interface ZwiftSnapshot {
  zwiftId?: string | undefined;
  /** The FTP set in Zwift — what its workouts scale to. */
  ftp?: number | undefined;
  weightKg?: number | undefined;
  zftp?: number | undefined;
  zmap?: number | undefined;
  /** The zFTP/zMAP category (power-profile), not the Racing Score band. */
  category?: ZwiftCategory | undefined;
  racingScore?: number | undefined;
  /** When Zwift last computed zFTP/zMAP (ISO timestamp). */
  metricsAt?: string | undefined;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const kg = (grams: unknown) => {
  const g = pos(grams);
  return g === undefined ? undefined : Math.round(g / 100) / 10;
};
const category = (v: unknown) => (zwiftCategories as readonly unknown[]).includes(v) ? (v as ZwiftCategory) : undefined;

/**
 * @param profile `GET /api/profiles/me` (JSON)
 * @param powerProfile `GET /api/power-curve/power-profile` — null when it failed or isn't there
 * @param publicProfile `GET /api/profiles/{id}` — null when it failed
 */
export function mapZwift(profile: unknown, powerProfile: unknown, publicProfile: unknown = null): ZwiftSnapshot {
  const p = isObj(profile) ? profile : {};
  const pp = isObj(powerProfile) ? powerProfile : {};
  // `/me` sends `competitionMetrics: null`; the same profile fetched by id carries the Racing Score.
  const byId = isObj(publicProfile) ? publicProfile['competitionMetrics'] : undefined;
  const competition = isObj(byId) ? byId : isObj(p['competitionMetrics']) ? p['competitionMetrics'] : {};
  const zftp = pos(pp['zftp']);
  const zmap = pos(pp['zmap']);
  return {
    zwiftId: typeof p['id'] === 'number' || typeof p['id'] === 'string' ? String(p['id']) : undefined,
    ftp: pos(p['ftp']) && Math.round(pos(p['ftp'])!),
    weightKg: kg(p['weight']) ?? kg(pp['weightInGrams']),
    zftp: zftp && Math.round(zftp),
    zmap: zmap && Math.round(zmap),
    category: category(pp['category']),
    racingScore: pos(competition['racingScore']) && Math.round(pos(competition['racingScore'])!),
    metricsAt: typeof pp['metricsTimestamp'] === 'string' ? pp['metricsTimestamp'] : undefined,
  };
}
