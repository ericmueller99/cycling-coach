import {
  describeFeedback,
  describeMainSet,
  describeTargets,
  formatLongDay,
  formatShortDate,
  formatWorkoutDuration,
  wattsPerKg,
  workoutMetrics,
  zoneWatts,
  ZONES,
  zwiftCategory,
} from '@cycling-coach/core';
import type {
  CalendarEvent,
  FitnessDay,
  Goal,
  IntegrationStatus,
  IsoDate,
  Memory,
  PowerBest,
  Profile,
  SessionFeedback,
  Workout,
} from '@cycling-coach/shared';
import { COACH_PERSONA } from './prompt';

export interface AthleteContext {
  /** The account name (Account page). */
  name?: string;
  profile: Profile;
  powerBests: PowerBest[];
  goals: Goal[];
  memories: Memory[];
  workouts: Workout[];
}

const PERIOD_LABEL: Record<PowerBest['period'], string> = {
  '90d': '90 days',
  season: 'Season',
  allTime: 'All-time',
};

function durationLabel(sec: number): string {
  return sec < 60 ? `${sec} s` : sec < 3600 ? `${sec / 60} min` : `${sec / 3600} h`;
}

/**
 * System block B: everything about the athlete that changes rarely. Rendered deterministically
 * (fixed ordering, no timestamps) so an unchanged profile renders byte-identical text — the
 * engine compares renders to decide whether the coach needs an "updated athlete context" note.
 */
export function renderAthleteBlock(ctx: AthleteContext): string {
  const { profile: p } = ctx;
  const lines: string[] = ['# Athlete'];
  if (ctx.name) lines.push(`Name: ${ctx.name}`);
  // Body weight changes daily, so it lives in the per-turn context, not here (keeps this block
  // stable and cached). The Zwift weight is a monthly baseline, so it's fine here.
  if (p.ftpZwift) {
    const ftp = p.ftpZwift;
    lines.push(
      `FTP ${ftp} W (set in Zwift)${p.zwiftWeightKg ? ` · Zwift weight ${p.zwiftWeightKg} kg (set in Zwift, used for race categories) → ${wattsPerKg(ftp, p.zwiftWeightKg).toFixed(2)} W/kg in Zwift` : ''}`,
    );
  } else {
    // DECISIONS #62: a new athlete who doesn't know their FTP starts with a ramp test.
    lines.push(
      'FTP: not known yet. Until a test sets it, prescribe by feel (RPE) and heart rate and never state watts. If the FTP Ramp Test is on the calendar, it comes first; once it has been ridden, propose the FTP from it (about 75% of the best one-minute power) as a profile update.',
    );
  }
  const zwiftLine = renderZwiftMetrics(p);
  if (zwiftLine) lines.push(zwiftLine);
  if (p.ftpZwift) {
    const ftp = p.ftpZwift;
    lines.push(
      `Zones at Zwift FTP: ${ZONES.map((z) => {
        const [lo, hi] = zoneWatts(z.zone, ftp);
        return Number.isFinite(hi) ? `${z.zone} ${lo}–${hi} W` : `${z.zone} >${lo - 1} W`;
      }).join(' · ')}`,
    );
  }
  lines.push(`Timezone: ${p.timezone}`);

  lines.push('', '# Power bests');
  const entered = ctx.powerBests.filter((b) => b.watts);
  if (entered.length === 0) lines.push('None entered.');
  for (const period of ['90d', 'season', 'allTime'] as const) {
    const rows = entered.filter((b) => b.period === period);
    if (rows.length === 0) continue;
    lines.push(
      `${PERIOD_LABEL[period]}: ${rows
        .map((b) => {
          const extra = [b.date ? formatShortDate(b.date) : '', b.source && b.source !== 'intervals.icu' ? b.source : ''].filter(Boolean).join(', ');
          return `${durationLabel(b.durationSec)} ${b.watts} W (${wattsPerKg(b.watts!, p.weightKg).toFixed(2)} W/kg${extra ? `; ${extra}` : ''})`;
        })
        .join(' · ')}`,
    );
  }

  lines.push('', '# Goals');
  if (ctx.goals.length === 0) lines.push('None set.');
  for (const g of ctx.goals) {
    const parts = [`[${g.horizon === 'long' ? 'long term' : 'short term'}${g.primary ? ', main goal' : ''}${g.done ? ', done' : ''}] ${g.title}`];
    if (g.detail) parts.push(g.detail);
    if (g.targetLabel) parts.push(`horizon: ${g.targetLabel}`);
    if (g.progress) parts.push(`${g.progress.label} now ${g.progress.current} ${g.progress.unit}, target ${g.progress.target}`);
    else if (g.measure && g.target !== undefined) parts.push(`target ${g.target} (${g.measure.kind}; no current data yet)`);
    lines.push(`- ${parts.join(' — ')}`);
  }

  lines.push('', '# Memory (id: note)');
  if (ctx.memories.length === 0) lines.push('Nothing saved yet.');
  for (const m of ctx.memories) lines.push(`- ${m.id}: ${m.text}`);

  lines.push('', '# Workout library (id · name · category · duration · main set · targets)');
  if (ctx.workouts.length === 0) lines.push('Empty.');
  for (const w of ctx.workouts) {
    const { totalSec } = workoutMetrics(w.segments);
    lines.push(
      `- ${w.id} · ${w.name} · ${w.category} · ${formatWorkoutDuration(totalSec)} · ${describeMainSet(w.segments)} · ${describeTargets(w.segments, p.ftpZwift)}${w.inZwift ? ' · in Zwift' : ''}`,
    );
  }
  return lines.join('\n');
}

/**
 * zFTP/zMAP, the category they give and what the next one up takes at the Zwift weight
 * (DECISIONS #23). Racing Score is labelled as context so the coach doesn't train towards it.
 */
function renderZwiftMetrics(p: Profile): string | null {
  const z = p.zwift;
  if (!z || (!z.zftp && !z.zmap)) return null;
  const kg = p.zwiftWeightKg ?? p.weightKg;
  const cat = zwiftCategory({ zftp: z.zftp, zmap: z.zmap, weightKg: kg });
  const metrics = [
    z.zftp ? `zFTP ${z.zftp} W = ${cat?.zftpWkg?.toFixed(2)} W/kg` : '',
    z.zmap ? `zMAP ${z.zmap} W = ${cat?.zmapWkg?.toFixed(2)} W/kg` : '',
  ].filter(Boolean);
  const next = cat?.nextUp
    ? ` ${cat.nextUp.category} needs zFTP ${cat.nextUp.zftpWkg} W/kg (${cat.nextUp.zftpWatts} W)${cat.nextUp.zmapWatts ? ` or zMAP ${cat.nextUp.zmapWkg} W/kg (${cat.nextUp.zmapWatts} W)` : ''}.`
    : '';
  const shown = z.category && z.category !== cat?.category ? ` (Zwift shows ${z.category})` : '';
  const score = z.racingScore ? ` Racing Score ${z.racingScore} (results-based; not a training target).` : '';
  return `Zwift race metrics (as of ${z.asOf}, ${z.source === 'zwift' ? 'synced from Zwift' : 'entered by hand'}): ${metrics.join(' · ')} on ${p.zwiftWeightKg ? 'Zwift' : 'trend'} weight ${kg} kg → category ${cat?.category}${shown}.${next}${score}`;
}

/** The frozen system prompt for a new API context: [persona, athlete]. */
export function buildSystemSnapshot(ctx: AthleteContext): string[] {
  return [COACH_PERSONA, renderAthleteBlock(ctx)];
}

/** "Zwift workout", "Zwift race 17:30 (B)", "ride" — what and where, for the coach. */
export function describeKind(e: Pick<CalendarEvent, 'kind' | 'platform' | 'startTime' | 'priority'>): string {
  const where = e.platform === 'garmin' ? 'Garmin' : 'Zwift';
  if (e.kind === 'workout') return `${where} workout`;
  if (e.kind === 'race') return `${where} race${e.startTime ? ` ${e.startTime}` : ''}${e.priority ? ` (${e.priority})` : ''}`;
  return `ride${e.startTime ? ` ${e.startTime}` : ''}`;
}

/** A session's status; a session the athlete grouped several rides into says so (DECISIONS #32). */
export function describeStatus(e: Pick<CalendarEvent, 'status' | 'extraActivityIds'>): string {
  const rides = 1 + (e.extraActivityIds?.length ?? 0);
  return e.status === 'done' && rides > 1 ? `done (${rides} rides)` : e.status;
}

/**
 * The calendar for the per-turn context. A done session the athlete rated carries `felt: RPE …` — ratings
 * are optional, so most may not. A new or edited rating changes the text, which is how it reaches
 * an open thread (the unchanged-calendar check sends it again).
 */
export function renderCalendarBlock(events: CalendarEvent[], from: IsoDate, to: IsoDate, feedback: readonly SessionFeedback[] = []): string {
  const lines = [`# Calendar ${from} → ${to} (id · date · kind · intensity · title · duration · status)`];
  if (events.length === 0) lines.push('Nothing scheduled.');
  const felt = new Map(feedback.flatMap((f) => (f.eventId ? [[f.eventId, f] as const] : [])));
  for (const e of events) {
    const dur = e.durationLabel ?? (e.durationMin ? `${e.durationMin} min` : '');
    const sync = e.kind === 'ride' ? '' : e.intervals ? (e.intervals.error ? 'sync failing' : 'on intervals.icu') : 'not yet synced';
    const flags = [e.tentative ? 'tentative' : '', describeStatus(e), sync, e.source === 'intervals' ? 'added in intervals.icu' : ''].filter(Boolean).join(', ');
    const rating = felt.get(e.id);
    const tail = [e.meta, e.coachNote ? `note: ${e.coachNote}` : '', rating ? `felt: ${describeFeedback(rating)}` : ''].filter(Boolean).join(' · ');
    lines.push(
      `- ${e.id} · ${formatLongDay(e.date)} · ${describeKind(e)} · ${e.type} · ${e.title}${dur ? ` · ${dur}` : ''} · ${flags}${tail ? ` · ${tail}` : ''}`,
    );
  }
  return lines.join('\n');
}

export interface TurnContextInput {
  /** Something the coach should know about this turn, from the deployment (e.g. a plan limit). */
  coachNote?: string | undefined;
  today: IsoDate;
  /** Local wall-clock time, e.g. "9:14 PM". */
  localTime: string;
  timezone: string;
  training: IntegrationStatus['status'];
  /** Today's fitness from intervals.icu, if available. */
  fitness?: FitnessDay | undefined;
  weight?:
    | {
        /** Unset until the athlete's FTP is known. */
        ftp?: number | undefined;
        trendKg: number;
        source: 'intervals.icu' | 'manual';
        latest?: { kg: number; date: IsoDate } | undefined;
      }
    | undefined;
  calendarBlock: string;
  athleteBlock: string;
  /** Today's food against the budget, when the food module has data. */
  food?: FoodTurnContext | undefined;
  /** What the coach has already been shown in this API context. */
  seen: { calendar?: string | undefined; athlete: string };
}

export interface FoodTurnContext {
  date: IsoDate;
  /** The meal the athlete is planning: the strip's choice, else the one for the time of day. */
  slot: string;
  /** True when the athlete picked slot/date in the app's food strip. */
  chosen: boolean;
  /** Eaten so far that day. */
  eaten: { kcal: number; protein: number; carbs: number; fat: number };
  /** Null until RMR is set on the Athlete page. */
  budgetKcal: number | null;
  proteinTargetG?: number | undefined;
  /** "No deficit (hard day)", a data warning … */
  note?: string | undefined;
}

const n0 = (x: number) => Math.round(x).toLocaleString('en-US');

/** One line: what they've eaten, what's left, and which meal is being planned. */
export function renderFoodLine(f: FoodTurnContext): string {
  const day = formatLongDay(f.date);
  const eaten = `eaten ${n0(f.eaten.kcal)} kcal · P ${n0(f.eaten.protein)} g · C ${n0(f.eaten.carbs)} g · F ${n0(f.eaten.fat)} g`;
  const budget =
    f.budgetKcal == null
      ? 'no calorie budget yet (RMR not set on the Athlete page)'
      : `budget ${n0(f.budgetKcal)} kcal → ${n0(f.budgetKcal - f.eaten.kcal)} kcal left${f.proteinTargetG ? `; protein target ${n0(f.proteinTargetG)} g → ${n0(Math.max(0, f.proteinTargetG - f.eaten.protein))} g left` : ''}`;
  const slot = f.chosen ? `The athlete is planning ${f.slot} for ${day} (picked in the app).` : `The meal for this time of day is ${f.slot}.`;
  return `Food ${day} (their food log): ${eaten}; ${budget}.${f.note ? ` ${f.note}.` : ''} ${slot}`;
}

/**
 * The first line is the window's dates, which move every day. The same sessions in a window one day
 * on are still "unchanged", or the first turn of every day would repeat the whole calendar.
 */
function sameCalendar(seen: string | undefined, block: string): boolean {
  const sessions = (text: string) => text.slice(text.indexOf('\n'));
  return seen !== undefined && sessions(seen) === sessions(block);
}

/**
 * The per-turn context message (sent as a mid-conversation system message after the athlete's message).
 * Appended, never rewritten. Unchanged calendar/athlete sections are referenced rather than
 * repeated, so a long thread doesn't grow by the full calendar every turn.
 */
export function renderTurnContext(input: TurnContextInput): string {
  const parts = [`Today is ${formatLongDay(input.today)} (${input.today}), ${input.localTime} ${input.timezone}.`];
  parts.push(
    input.training === 'connected'
      ? 'Training data: intervals.icu connected.'
      : input.training === 'error'
        ? 'Training data: intervals.icu is failing right now — say so if you need ride data rather than guessing.'
        : 'Training data: intervals.icu is not connected for this athlete — you cannot fetch rides. Suggest connecting it.',
  );
  if (input.fitness) {
    const f = input.fitness;
    parts.push(
      `Fitness today (intervals.icu): CTL ${f.ctl.toFixed(1)} · ATL ${f.atl.toFixed(1)} · form ${f.form >= 0 ? '+' : ''}${f.form.toFixed(1)}${f.rampRate !== undefined ? ` · ramp ${f.rampRate.toFixed(1)}/wk` : ''}.`,
    );
  }
  if (input.weight) {
    const w = input.weight;
    const wkg = w.ftp ? ` → ${wattsPerKg(w.ftp, w.trendKg).toFixed(2)} W/kg` : '';
    parts.push(
      w.source === 'intervals.icu'
        ? `Weight (intervals.icu weigh-ins): trend ${w.trendKg} kg (median of the last 7 days)${w.latest ? `, last weigh-in ${w.latest.kg} kg on ${w.latest.date}` : ''}${wkg}.`
        : `Weight: ${w.trendKg} kg (entered by the athlete)${wkg}.`,
    );
  }
  if (input.food) parts.push(renderFoodLine(input.food));
  parts.push(
    sameCalendar(input.seen.calendar, input.calendarBlock)
      ? 'Calendar: unchanged since the previous context message.'
      : input.calendarBlock,
  );
  if (input.athleteBlock !== input.seen.athlete) {
    parts.push(
      'The athlete has changed their profile, goals, memory or library since this conversation started. This replaces the athlete context in the system prompt:',
      input.athleteBlock,
    );
  }
  if (input.coachNote) parts.push(input.coachNote);
  return parts.join('\n\n');
}
