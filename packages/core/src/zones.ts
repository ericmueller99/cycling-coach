/**
 * Power zones as % FTP, with their chart colours. Upper bounds are inclusive:
 * 55% is Z1, 56% is Z2.
 */
export const ZONES = [
  { zone: 'Z1', name: 'Recovery', maxPct: 55, color: '#7A8494' },
  { zone: 'Z2', name: 'Endurance', maxPct: 75, color: '#3B8BF6' },
  { zone: 'Z3', name: 'Tempo', maxPct: 90, color: '#2FBF71' },
  { zone: 'Z4', name: 'Threshold', maxPct: 105, color: '#E9B80F' },
  { zone: 'Z5', name: 'VO2 max', maxPct: 120, color: '#F5782A' },
  { zone: 'Z6', name: 'Anaerobic', maxPct: Infinity, color: '#EF4444' },
] as const;

export type Zone = (typeof ZONES)[number];

export function zoneFor(pct: number): Zone {
  // Round first so 55.4% (from a ramp midpoint) lands in Z1 like the integer it displays as.
  const p = Math.round(pct);
  return ZONES.find((z) => p <= z.maxPct) ?? ZONES[ZONES.length - 1]!;
}

export function zoneColor(pct: number): string {
  return zoneFor(pct).color;
}

export function watts(pct: number, ftp: number): number {
  return Math.round((pct / 100) * ftp);
}

/** Watt range for a zone at the given FTP, e.g. Z2 at 300 W → [168, 225]. */
export function zoneWatts(zone: Zone['zone'], ftp: number): [number, number] {
  const i = ZONES.findIndex((z) => z.zone === zone);
  const lowPct = i === 0 ? 0 : ZONES[i - 1]!.maxPct + 1;
  const highPct = ZONES[i]!.maxPct;
  return [watts(lowPct, ftp), Number.isFinite(highPct) ? watts(highPct, ftp) : Infinity];
}

export function wattsPerKg(w: number, kg: number): number {
  return Math.round((w / kg) * 100) / 100;
}
