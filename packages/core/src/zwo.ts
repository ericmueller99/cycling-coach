import type { WorkoutCategory, WorkoutSegment } from '@cycling-coach/shared';

/**
 * Zwift `.zwo` export and import.
 *
 * Power attributes are fractions of FTP (1.12 = 112%). In `Warmup`, `Cooldown` and `Ramp`,
 * `PowerLow` is the power at the START of the block and `PowerHigh` at the END — so a cool-down
 * from 55% to 45% has PowerLow > PowerHigh. The names are Zwift's, not ours.
 */

export interface ZwoWorkout {
  name: string;
  description?: string | undefined;
  category?: WorkoutCategory | undefined;
  segments: readonly WorkoutSegment[];
}

const frac = (pct: number) => String(Math.round(pct) / 100);

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unesc(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function buildZwo(workout: ZwoWorkout, opts: { author?: string } = {}): string {
  const lines: string[] = [];
  const last = workout.segments.length - 1;

  workout.segments.forEach((seg, i) => {
    if (seg.kind === 'ramp') {
      const tag =
        i === 0 && seg.toPct >= seg.fromPct
          ? 'Warmup'
          : i === last && seg.toPct <= seg.fromPct
            ? 'Cooldown'
            : 'Ramp';
      lines.push(
        `<${tag} Duration="${seg.durSec}" PowerLow="${frac(seg.fromPct)}" PowerHigh="${frac(seg.toPct)}"/>`,
      );
    } else if (seg.kind === 'steady') {
      const cad = seg.cadence ? ` Cadence="${seg.cadence}"` : '';
      lines.push(`<SteadyState Duration="${seg.durSec}" Power="${frac(seg.pct)}"${cad}/>`);
    } else if (seg.steps.length === 2) {
      const [on, off] = seg.steps as [(typeof seg.steps)[0], (typeof seg.steps)[0]];
      const cad = on.cadence ? ` Cadence="${on.cadence}"` : '';
      const cadRest = off.cadence ? ` CadenceResting="${off.cadence}"` : '';
      lines.push(
        `<IntervalsT Repeat="${seg.count}" OnDuration="${on.durSec}" OffDuration="${off.durSec}" ` +
          `OnPower="${frac(on.pct)}" OffPower="${frac(off.pct)}"${cad}${cadRest}/>`,
      );
    } else {
      // IntervalsT is strictly on/off. Anything else is written out longhand.
      for (let r = 0; r < seg.count; r++) {
        for (const step of seg.steps) {
          const cad = step.cadence ? ` Cadence="${step.cadence}"` : '';
          lines.push(`<SteadyState Duration="${step.durSec}" Power="${frac(step.pct)}"${cad}/>`);
        }
      }
    }
  });

  const tags = workout.category ? `\n  <tags>\n    <tag name="${esc(workout.category)}"/>\n  </tags>` : '';
  return [
    '<workout_file>',
    `  <author>${esc(opts.author ?? 'Cycling Coach')}</author>`,
    `  <name>${esc(workout.name)}</name>`,
    `  <description>${esc(workout.description ?? '')}</description>`,
    `  <sportType>bike</sportType>${tags}`,
    '  <workout>',
    ...lines.map((l) => `    ${l}`),
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

export interface ParsedZwo {
  name: string;
  description: string;
  segments: WorkoutSegment[];
  /** Elements we couldn't represent exactly (FreeRide, MaxEffort, …) and how they were mapped. */
  warnings: string[];
}

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([A-Za-z_]+)\s*=\s*"([^"]*)"/g)) out[m[1]!.toLowerCase()] = m[2]!;
  return out;
}

const num = (v: string | undefined, fallback = 0) => (v === undefined ? fallback : Number(v));
const pctOf = (v: string | undefined, fallback = 0) => Math.round(num(v, fallback / 100) * 100);
const int = (v: string | undefined) => Math.max(1, Math.round(num(v, 1)));

export function parseZwo(xml: string): ParsedZwo {
  const name = unesc(/<name>([\s\S]*?)<\/name>/i.exec(xml)?.[1]?.trim() ?? 'Imported workout');
  const description = unesc(/<description>([\s\S]*?)<\/description>/i.exec(xml)?.[1]?.trim() ?? '');
  const body = /<workout>([\s\S]*?)<\/workout>/i.exec(xml)?.[1] ?? '';
  const segments: WorkoutSegment[] = [];
  const warnings: string[] = [];

  for (const m of body.matchAll(/<(\w+)\b([^>]*?)\/?>/g)) {
    const tag = m[1]!.toLowerCase();
    const a = attrs(m[2]!);
    switch (tag) {
      case 'warmup':
      case 'cooldown':
      case 'ramp':
        segments.push({
          kind: 'ramp',
          durSec: int(a['duration']),
          fromPct: pctOf(a['powerlow']),
          toPct: pctOf(a['powerhigh']),
        });
        break;
      case 'steadystate':
        segments.push({
          kind: 'steady',
          durSec: int(a['duration']),
          // intervals.icu exports target ranges (PowerLow/PowerHigh) instead of a single Power.
          pct:
            a['power'] !== undefined
              ? pctOf(a['power'])
              : Math.round((pctOf(a['powerlow']) + pctOf(a['powerhigh'] ?? a['powerlow'])) / 2),
          ...(a['cadence'] ? { cadence: Math.round(num(a['cadence'])) } : {}),
        });
        break;
      case 'intervalst':
        segments.push({
          kind: 'repeat',
          count: int(a['repeat']),
          steps: [
            {
              durSec: int(a['onduration']),
              pct: pctOf(a['onpower']),
              ...(a['cadence'] ? { cadence: Math.round(num(a['cadence'])) } : {}),
            },
            {
              durSec: int(a['offduration']),
              pct: pctOf(a['offpower']),
              ...(a['cadenceresting'] ? { cadence: Math.round(num(a['cadenceresting'])) } : {}),
            },
          ],
        });
        break;
      case 'freeride':
        segments.push({ kind: 'steady', durSec: int(a['duration']), pct: 60 });
        warnings.push('FreeRide imported as 60% steady.');
        break;
      case 'maxeffort':
        segments.push({ kind: 'steady', durSec: int(a['duration']), pct: 150 });
        warnings.push('MaxEffort imported as 150% steady.');
        break;
      case 'textevent':
      case 'textnotification':
        break; // On-screen messages — not part of the power profile.
      default:
        warnings.push(`Skipped unsupported <${m[1]}> element.`);
    }
  }
  return { name, description, segments, warnings };
}

export function zwoFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'workout'}.zwo`;
}
