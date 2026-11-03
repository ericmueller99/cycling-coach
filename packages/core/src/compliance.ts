import type { ActivityInterval, SessionCompliance, WorkoutSegment } from '@cycling-coach/shared';
import { flatten } from './workout';
import { watts } from './zones';

/** A detected interval pairs with a planned rep when its length is within this ratio of the rep's. */
const PAIR_MIN = 0.7;
const PAIR_MAX = 1.3;
/** A rep counts as done at this share of its target power. */
const REP_DONE = 0.9;

interface PlannedRep {
  durSec: number;
  watts: number;
}

/**
 * Planned work reps: the workout's work steps, with back-to-back work steps merged into one rep
 * (Surge and Settle's 1 min surge + 3 min settle is one 4-min effort to intervals.icu).
 */
function plannedReps(segments: readonly WorkoutSegment[], ftp: number): PlannedRep[] {
  const reps: { durSec: number; pctSec: number }[] = [];
  let open = false;
  for (const step of flatten(segments)) {
    if (step.role !== 'work') {
      open = false;
      continue;
    }
    const last = reps[reps.length - 1];
    if (open && last) {
      last.durSec += step.durSec;
      last.pctSec += step.pct * step.durSec;
    } else reps.push({ durSec: step.durSec, pctSec: step.pct * step.durSec });
    open = true;
  }
  return reps.map((r) => ({ durSec: r.durSec, watts: watts(r.pctSec / r.durSec, ftp) }));
}

function mostCommon(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
}

/**
 * How a ride's detected WORK intervals compare with a workout's planned reps.
 * Reps and intervals are walked in order; each rep takes the next interval of a similar length,
 * and intervals left over are `extras` (a warm-up opener, a sprint). Null when nothing pairs —
 * e.g. 30/15s that intervals.icu detects as one block.
 */
export function sessionCompliance(
  segments: readonly WorkoutSegment[],
  ftp: number,
  intervals: readonly ActivityInterval[],
): SessionCompliance | null {
  const planned = plannedReps(segments, ftp);
  const work = intervals.filter((i): i is ActivityInterval & { avgWatts: number } => i.type === 'WORK' && !!i.avgWatts && i.durationSec > 0);
  if (!planned.length || !work.length) return null;

  const paired: { rep: PlannedRep; actual: ActivityInterval & { avgWatts: number } }[] = [];
  const used = new Set<number>();
  let next = 0;
  for (const rep of planned) {
    for (let k = next; k < work.length; k++) {
      const ratio = work[k]!.durationSec / rep.durSec;
      if (ratio >= PAIR_MIN && ratio <= PAIR_MAX) {
        paired.push({ rep, actual: work[k]! });
        used.add(k);
        next = k + 1;
        break;
      }
    }
  }
  if (!paired.length) return null;

  const sum = (f: (p: (typeof paired)[number]) => number) => paired.reduce((s, p) => s + f(p), 0);
  const plannedSec = sum((p) => p.rep.durSec);
  const plannedWatts = sum((p) => p.rep.watts * p.rep.durSec) / plannedSec;
  const actualWatts = sum((p) => p.actual.avgWatts * p.rep.durSec) / plannedSec;
  const pct = Math.round((actualWatts / plannedWatts) * 100);
  return {
    pct,
    band: pct >= 95 ? 'hit' : pct >= 85 ? 'close' : 'under',
    repsDone: paired.filter((p) => p.actual.avgWatts >= p.rep.watts * REP_DONE).length,
    repsPlanned: planned.length,
    repSec: mostCommon(planned.map((r) => r.durSec)),
    actualRepSec: Math.round(sum((p) => p.actual.durationSec) / paired.length),
    plannedWatts: Math.round(plannedWatts),
    actualWatts: Math.round(actualWatts),
    extras: work.filter((_, k) => !used.has(k)).map((i) => ({ durationSec: i.durationSec, watts: i.avgWatts })),
  };
}
