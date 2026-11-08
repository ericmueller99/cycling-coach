import {
  describeFeedback,
  describeReason,
  describeMainSet,
  describeTargets,
  formatLongDay,
  formatShortDate,
  formatWorkoutDuration,
  goalTakesDate,
  paceLabel,
  timeOffOn,
  wattsPerKg,
  workoutMetrics,
  zoneWatts,
  ZONES,
  zwiftCategory,
  isRating,
} from '@cycling-coach/core';
import {
  TIME_OFF_LABEL,
  TRAINING_PREFERENCE_LABEL,
  WEEKDAY_LABEL,
  type CalendarEvent,
  type FitnessDay,
  type Goal,
  type IntegrationStatus,
  type IsoDate,
  type Memory,
  type PowerBest,
  type Profile,
  type SessionFeedback,
  type TimeOff,
  type Workout,
} from '@cycling-coach/shared';
import { COACH_PERSONA } from './prompt';

export interface AthleteContext {
  /** The account name (Account page). */
  name?: string;
  profile: Profile;
  powerBests: PowerBest[];
  goals: Goal[];
  /** Long-term notes. They go in the athlete block. */
  memories: Memory[];
  /** Short-term notes, expired ones included. They go in the per-turn context, never the block. */
  shortTerm: Memory[];
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

function renderAvailability({ usualWeek: w }: Profile): string {
  if (!w) return 'Availability: they tell you as they chat';
  const hours = w.hoursPerWeek ? `about ${w.hoursPerWeek} h` : '';
  return `Usual week: ${[w.days.map((d) => WEEKDAY_LABEL[d]).join(', '), hours].filter(Boolean).join(' · ')}`;
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
  if (p.trainingPreference) lines.push(`Training preference: ${TRAINING_PREFERENCE_LABEL[p.trainingPreference]}`);
  lines.push(renderAvailability(p));

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
          // Watts only: W/kg here would move with the trend weight and resend this block.
          return `${durationLabel(b.durationSec)} ${b.watts} W${extra ? ` (${extra})` : ''}`;
        })
        .join(' · ')}`,
    );
  }

  lines.push('', '# Goals');
  if (ctx.goals.length === 0) lines.push('None set.');
  for (const g of ctx.goals) {
    const parts = [`[${g.horizon === 'long' ? 'long term' : 'short term'}${g.primary ? ', main goal' : ''}${g.done ? ', done' : ''}] ${g.title}`];
    if (g.detail) parts.push(g.detail);
    // Open-ended goals have no date (DECISIONS #86), even if an older one still stores one.
    if (g.targetDate && goalTakesDate(g)) parts.push(`event date ${g.targetDate}`);
    // A weight goal has a pace, not a date (DECISIONS #96). Its estimated arrival moves with the trend weight, so it stays out.
    if (g.measure?.kind === 'weight') parts.push(g.pace ? `pace ${paceLabel(g.pace)}` : 'no pace picked yet');
    // A value on the trend weight would resend this block every time the trend moves.
    if (g.progress?.onTrendWeight) parts.push(`${g.progress.label} target ${g.progress.target} ${g.progress.unit}, current value from the weight in the context message`);
    else if (g.progress) parts.push(`${g.progress.label} now ${g.progress.current} ${g.progress.unit}, target ${g.progress.target}`);
    else if (g.measure && g.target !== undefined) parts.push(`target ${g.target} (${g.measure.kind}; no current data yet)`);
    lines.push(`- ${parts.join(' — ')}`);
  }

  lines.push('', '# Long-term memory (id: note)');
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

/**
 * The short-term notes for the per-turn context (DECISIONS #79). They stay out of the athlete block,
 * where every note added or lapsed would resend the whole block into every open thread. Empty when
 * there are none. No relative dates, so the text only changes when the notes do.
 */
export function renderShortTermBlock(notes: Memory[]): string {
  if (notes.length === 0) return '';
  return [
    "# Short-term notes (id (until): note). This is the full current list: anything earlier that isn't here has lapsed or been deleted, so don't save it again.",
    ...notes.map((m) => `- ${m.id} (until ${formatLongDay(m.until!)}): ${m.text}`),
  ].join('\n');
}

/** "t1 · Sick · Mon Nov 9 → Sun Nov 15 · Head cold" — what the context and `get_calendar` show. */
export function describeTimeOff(t: TimeOff): string {
  return [t.id, TIME_OFF_LABEL[t.kind], `${formatLongDay(t.startDate)} → ${formatLongDay(t.endDate)}`, ...(t.note ? [t.note] : [])].join(' · ');
}

/**
 * Time off for the per-turn context, sent when it changes. Like short-term notes it stays out of the
 * athlete block, and it reaches much further ahead than the calendar block, so a plan four weeks out
 * knows about a vacation. No relative dates, so the text only changes when the entries do.
 */
export function renderTimeOffBlock(entries: TimeOff[]): string {
  if (entries.length === 0) return '';
  return [
    "# Time off (id · kind · first day → last day · note). The athlete won't train on these days. This is the full current list.",
    ...entries.map((t) => `- ${describeTimeOff(t)}`),
  ].join('\n');
}

/** "Today is sick time off, through Sun Nov 15." Empty on a normal day. Sent every turn it's true. */
export function renderTimeOffToday(entries: TimeOff[], today: IsoDate): string {
  const lines = timeOffOn(entries, today).map((t) => `Today is ${TIME_OFF_LABEL[t.kind].toLowerCase()} time off, through ${formatLongDay(t.endDate)}.`);
  return lines.join(' ');
}

/**
 * The frozen system prompt for a new API context: [persona, athlete, recap?]. The recap is its own block
 * because `seen.athlete` is compared against the athlete block alone.
 */
export function buildSystemSnapshot(ctx: AthleteContext, recap?: string): string[] {
  return [COACH_PERSONA, renderAthleteBlock(ctx), ...(recap ? [recap] : [])];
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
 * What the athlete said about a session: `felt: RPE …` on a done one they rated, `why: "…"` on a missed or
 * skipped one they gave a reason for (DECISIONS #97). Empty otherwise — both are optional. A reason left on
 * a session that was later ridden stays out.
 */
export function describeSessionFeedback(e: Pick<CalendarEvent, 'status'>, fb: SessionFeedback | undefined): string {
  if (!fb) return '';
  if (e.status === 'done') return isRating(fb) ? `felt: ${describeFeedback(fb)}` : '';
  if (e.status === 'missed' || e.status === 'skipped') return !isRating(fb) && fb.note?.trim() ? `why: ${describeReason(fb)}` : '';
  return '';
}

/**
 * The calendar for the per-turn context, with what the athlete said about past sessions
 * (`describeSessionFeedback`). A new or edited rating or reason changes the text, which is how it
 * reaches an open thread (the unchanged-calendar check sends it again).
 */
export function renderCalendarBlock(events: CalendarEvent[], from: IsoDate, to: IsoDate, feedback: readonly SessionFeedback[] = []): string {
  const lines = [`# Calendar ${from} → ${to} (id · date · kind · intensity · title · duration · status)`];
  if (events.length === 0) lines.push('Nothing scheduled.');
  const felt = new Map(feedback.flatMap((f) => (f.eventId ? [[f.eventId, f] as const] : [])));
  for (const e of events) {
    const dur = e.durationLabel ?? (e.durationMin ? `${e.durationMin} min` : '');
    const sync = e.kind === 'ride' ? '' : e.intervals ? (e.intervals.error ? 'sync failing' : 'on intervals.icu') : 'not yet synced';
    const flags = [e.tentative ? 'tentative' : '', describeStatus(e), sync, e.source === 'intervals' ? 'added in intervals.icu' : ''].filter(Boolean).join(', ');
    const tail = [e.meta, e.coachNote ? `note: ${e.coachNote}` : '', describeSessionFeedback(e, felt.get(e.id))].filter(Boolean).join(' · ');
    lines.push(
      `- ${e.id} · ${formatLongDay(e.date)} · ${describeKind(e)} · ${e.type} · ${e.title}${dur ? ` · ${dur}` : ''} · ${flags}${tail ? ` · ${tail}` : ''}`,
    );
  }
  return lines.join('\n');
}

/** intervals.icu's status, or `stored`: not connected, but the ride tools have rides from elsewhere to read (DECISIONS #90). */
export type TrainingStatus = IntegrationStatus['status'] | 'stored';

const TRAINING_LINE: Record<TrainingStatus, string> = {
  connected: 'Training data: intervals.icu connected.',
  error: 'Training data: intervals.icu is failing right now — say so if you need ride data rather than guessing.',
  not_configured: 'Training data: intervals.icu is not connected for this athlete — you cannot fetch rides. Suggest connecting it.',
  stored:
    "Training data: rides are stored here from another source, and the ride tools read them. They may have no training load, and fitness and power curves may be empty. Don't ask the athlete to connect anything else unless they ask what it would add.",
};

export interface TurnContextInput {
  /** Something the coach should know about this turn, from the deployment (e.g. a plan limit). */
  coachNote?: string | undefined;
  today: IsoDate;
  /** Local wall-clock time, e.g. "9:14 PM". */
  localTime: string;
  timezone: string;
  training: TrainingStatus;
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
  /** Today's short-term notes, from `renderShortTermBlock`. */
  shortTermBlock: string;
  /** Time off near today, from `renderTimeOffBlock`. */
  timeOffBlock: string;
  /** From `renderTimeOffToday`. */
  timeOffToday: string;
  /** Today's food against the budget, when the food module has data. */
  food?: FoodTurnContext | undefined;
  /** Anything else the deployment knows about the athlete today (DECISIONS #72). */
  extra?: string | undefined;
  /** What the coach has already been shown in this API context. */
  seen: { calendar?: string | undefined; athlete: string; extra?: string | undefined; shortTerm?: string | undefined; timeOff?: string | undefined };
}

export interface FoodTurnContext {
  date: IsoDate;
  /** The meal the athlete is planning: the strip's choice, else the one for the time of day. */
  slot: string;
  /** True when the athlete picked slot/date in the app's food strip. */
  chosen: boolean;
  /** Eaten so far that day. */
  eaten: { kcal: number; protein: number; carbs: number; fat: number };
  /** How many restaurant estimates `eaten` includes, so the coach doesn't quote it as exact. */
  estimates?: number | undefined;
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
  const guessed = f.estimates ? ` These totals include ${f.estimates === 1 ? 'a restaurant meal' : `${f.estimates} restaurant meals`} logged as an estimate, so treat them as approximate.` : '';
  return `Food ${day} (their food log): ${eaten}; ${budget}.${guessed}${f.note ? ` ${f.note}.` : ''} ${slot}`;
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
  parts.push(TRAINING_LINE[input.training]);
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
  if (input.timeOffToday) parts.push(input.timeOffToday);
  if (input.food) parts.push(renderFoodLine(input.food));
  // Only when it changed: the coach already has it, and each copy stays in the transcript.
  if (input.extra && input.extra !== input.seen.extra) parts.push(input.extra);
  // Strict, unlike `extra`: an empty list after a full one is news the coach needs.
  if (input.shortTermBlock !== (input.seen.shortTerm ?? '')) {
    parts.push(input.shortTermBlock || "Short-term notes: none current. Earlier ones have lapsed or been deleted, so don't save them again.");
  }
  if (input.timeOffBlock !== (input.seen.timeOff ?? '')) parts.push(input.timeOffBlock || 'Time off: none now. Earlier entries have ended or been removed.');
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
