import type { BodyScanInput } from '@cycling-coach/shared';
import { roundTo } from './units';

/**
 * Fat-free mass from a body scan: as reported, else lean soft tissue + bone mineral, else
 * weight × (1 − body fat %). Lean alone (without bone) is close enough when bone is missing.
 */
export function fatFreeMass(scan: Pick<BodyScanInput, 'weightKg' | 'bodyFatPct' | 'leanMassKg' | 'boneMineralKg' | 'fatFreeMassKg'>): number {
  if (scan.fatFreeMassKg) return roundTo(scan.fatFreeMassKg, 1);
  if (scan.leanMassKg) return roundTo(scan.leanMassKg + (scan.boneMineralKg ?? 0), 1);
  return roundTo(scan.weightKg * (1 - scan.bodyFatPct / 100), 1);
}

/** Katch-McArdle: BMR = 370 + 21.6 × fat-free mass (kg). Uses lean mass, so it suits lean athletes. */
export function katchMcArdle(fatFreeMassKg: number): number {
  return Math.round(370 + 21.6 * fatFreeMassKg);
}
