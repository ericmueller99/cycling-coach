import type Anthropic from '@anthropic-ai/sdk';
import { daysBetween, describeFeedback, formatLongDay, formatRange, formatStepDuration, sessionsInSpan } from '@cycling-coach/core';
import {
  calendarChangeSchema,
  eventFiltersSchema,
  eventSorts,
  goalProposalSchema,
  ingredientLineSchema,
  isoDateSchema,
  mealDifficulties,
  planItemSchema,
  profileUpdateSchema,
  TIME_OFF_LABEL,
  timeOffInputSchema,
  timeOffKindSchema,
  workoutInputSchema,
  type Activity,
  type ActivityDetail,
  type CalendarEvent,
  type EventQuery,
  type EventQueryResult,
  type FitnessDay,
  type GoalProposal,
  type IngredientLine,
  type IsoDate,
  type MealDifficulty,
  type MealIdeas,
  type Nutrients,
  type RecipeDraft,
  type TimeOff,
  type Memory,
  type MemoryInput,
  type MemoryPatch,
  type MemoryUpdate,
  type PlanItem,
  type PowerCurve,
  type PowerCurvePeriod,
  type Proposal,
  type ProposalChange,
  type ProfileUpdate,
  type SessionFeedback,
  type UiBlock,
  type Workout,
  type WorkoutInput,
  terrains,
  zwiftEventTypeSchema,
} from '@cycling-coach/shared';
import { z } from 'zod';
import { describeKind, describeStatus, describeTimeOff } from './context';
import { toStrictSchema } from './schema';

/**
 * Everything a tool may touch, injected by the API. The coach package never imports the database
 * or the intervals.icu client — it gets these narrow ports instead, which also makes the tool loop
 * testable with fakes.
 */
export interface CoachPorts {
  /** Null when intervals.icu isn't configured. */
  training: TrainingDataPort | null;
  listCalendar(from: IsoDate, to: IsoDate): Promise<CalendarEvent[]>;
  listTimeOff(from: IsoDate, to: IsoDate): Promise<TimeOff[]>;
  getTimeOff(id: string): Promise<TimeOff | null>;
  createProposal(p: NewProposal): Promise<Proposal>;
  createWorkout(input: WorkoutInput): Promise<Workout>;
  remember(input: MemoryInput): Promise<Memory | { error: string }>;
  updateMemory(memoryId: string, patch: MemoryPatch): Promise<MemoryUpdate | { error: string } | null>;
  forget(memoryId: string): Promise<Memory | null>;
  /** Zwift events from the app's own synced copy (never calls Zwift), and the zone to show times in. */
  findEvents(query: EventQuery): Promise<{ result: EventQueryResult; timeZone: string }>;
  /** The athlete's optional ride ratings (RPE + note) for these intervals.icu activities. */
  feedbackForActivities(activityIds: string[]): Promise<SessionFeedback[]>;
  /** Ratings dated in a range, newest first, optionally for one library workout. */
  listFeedback(range: { start: IsoDate; end: IsoDate; workoutId?: string | undefined }): Promise<SessionFeedback[]>;
  /** Meal ideas and recipes. Null when the food module can't price them (no API key). */
  food: CoachFoodPort | null;
}

export interface NewMealIdeas {
  toolUseId: string;
  slot: string;
  date: IsoDate;
  ideas: {
    tag: string;
    name: string;
    description: string;
    minutes: number;
    servings: number;
    ingredients: IngredientLine[];
    difficulty?: MealDifficulty | undefined;
    equipment?: string[] | undefined;
    leftovers?: string | undefined;
    why?: string | undefined;
    steps?: string[] | undefined;
  }[];
  followUps: string[];
  kcalRange?: { min: number; max: number } | undefined;
}

export interface NewRecipeDraft {
  toolUseId: string;
  ideasId?: string | undefined;
  ideaIndex?: number | undefined;
  name: string;
  description?: string | undefined;
  servings: number;
  minutes?: number | undefined;
  ingredients: IngredientLine[];
  steps: string[];
}

/**
 * Drafts only: ideas and recipes are stored for the cards, each ingredient matched to the athlete's foods
 * (or a staple) and priced in code. Nothing reaches their foods, recipes or log until they press Log
 * or Save as recipe.
 */
export interface CoachFoodPort {
  createMealIdeas(input: NewMealIdeas): Promise<MealIdeas>;
  createRecipeDraft(input: NewRecipeDraft): Promise<RecipeDraft>;
}

/** Training history. Implemented over intervals.icu today; any source with these shapes fits. */
export interface TrainingDataPort {
  listActivities(range: { start: IsoDate; end: IsoDate }): Promise<Activity[]>;
  searchActivities(query: string): Promise<Activity[]>;
  getActivityDetail(id: string, opts: { powerCurve: boolean }): Promise<ActivityDetail>;
  getPowerCurves(periods: PowerCurvePeriod[]): Promise<PowerCurve[]>;
  getFitness(range: { start: IsoDate; end: IsoDate }): Promise<FitnessDay[]>;
}

export type NewProposal = {
  toolUseId: string;
  title: string;
  subtitle?: string;
  /** Id of an earlier card, in this chat or the one before it, that this one revises; its pending items get dismissed. */
  replaces?: string;
} & (
  | { kind: 'plan'; items: PlanItem[] }
  | { kind: 'calendar_changes'; items: ProposalChange[] }
  | { kind: 'profile_update'; items: [ProfileUpdate] }
  | { kind: 'goal'; items: [GoalProposal] }
);

export interface ToolOutcome {
  /** What the model sees. */
  content: string;
  isError?: boolean;
  /** What the athlete sees. */
  ui?: Exclude<UiBlock, { type: 'text' }>;
}

export interface ToolRunContext {
  toolUseId: string;
  ports: CoachPorts;
  today: IsoDate;
}

interface CoachTool<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  source: 'data' | 'app';
  /** Chip label while the tool runs; omitted for tools that render a card instead. */
  runningLabel?: string;
  /** `build`: this tool's work belongs on the build model, so the engine moves the turn there first. */
  tier?: 'build';
  /**
   * Strict (grammar-constrained) input. Default true. Off for the large card/workout schemas: the
   * API compiles every strict schema in a request into one grammar and rejects the request when it
   * gets too big ("The compiled grammar is too large"). Those inputs are still Zod-validated in
   * `runTool`, and a failure goes back to the model as an error it can correct.
   */
  strict?: boolean;
  run(input: z.infer<S>, ctx: ToolRunContext): Promise<ToolOutcome>;
}

function defineTool<S extends z.ZodType>(tool: CoachTool<S>): CoachTool<S> {
  return tool;
}

const MAX_RANGE_DAYS = 120;
const FEEDBACK_MAX_DAYS = 180;

function trainingUnavailable(): ToolOutcome {
  return {
    content: 'intervals.icu is not connected for this athlete, so training data cannot be fetched. Suggest connecting it.',
    isError: true,
  };
}

function hms(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const isRaceLike = (a: Activity) => a.isRace === true || /\brace\b/i.test(a.name);

/** One compact line per activity for the model — id first so it can ask for detail. */
export function formatActivityForModel(a: Activity, feedback?: SessionFeedback): string {
  const parts = [
    a.id,
    a.startLocal.replace('T', ' ').slice(0, 16),
    a.type + (a.isTrainer ? ' (indoor)' : '') + (isRaceLike(a) ? ' (race)' : ''),
    a.name,
    `${hms(a.movingSec)} moving`,
    `${(a.distanceM / 1000).toFixed(1)} km`,
  ];
  if (a.avgWatts) parts.push(`avg ${a.avgWatts} W`);
  if (a.normalizedWatts) parts.push(`NP ${a.normalizedWatts} W`);
  if (a.intensityPct) parts.push(`IF ${(a.intensityPct / 100).toFixed(2)}`);
  if (a.trainingLoad !== undefined) parts.push(`load ${a.trainingLoad}`);
  if (a.avgHr) parts.push(`HR ${a.avgHr}`);
  if (a.avgCadence) parts.push(`${Math.round(a.avgCadence)} rpm`);
  if (a.elevationM) parts.push(`+${Math.round(a.elevationM)} m`);
  if (a.intervalSummary?.length) parts.push(`intervals: ${a.intervalSummary.join(', ')}`);
  if (feedback) parts.push(`felt: ${describeFeedback(feedback)}`);
  if (a.description) parts.push(`desc: ${a.description.replace(/\s+/g, ' ').slice(0, 200)}`);
  return parts.join(' · ');
}

/**
 * The athlete's ratings for these rides, by activity id. Ratings are optional extras on the ride data, so
 * a failed lookup just leaves them out rather than failing the tool.
 */
async function feedbackByActivity(ports: CoachPorts, activities: readonly Activity[]): Promise<Map<string, SessionFeedback>> {
  if (!activities.length) return new Map();
  const ratings = await ports.feedbackForActivities(activities.map((a) => a.id)).catch(() => []);
  return new Map(ratings.flatMap((f) => (f.activityId ? [[f.activityId, f] as const] : [])));
}

const rowFor = (a: Activity) =>
  `${formatLongDay(a.startLocal.slice(0, 10))} · ${a.name} · ${Math.round(a.movingSec / 60)} min${a.trainingLoad !== undefined ? ` · load ${a.trainingLoad}` : ''}`;

/** "Pulled 16 rides from intervals.icu · Oct 20 – 28 · 5 races, 10.1 h, load 540" */
export function activityChip(activities: Activity[], start: IsoDate, end: IsoDate) {
  const hours = activities.reduce((s, a) => s + a.movingSec, 0) / 3600;
  const load = activities.reduce((s, a) => s + (a.trainingLoad ?? 0), 0);
  const races = activities.filter(isRaceLike).length;
  const noun = activities.length === 1 ? 'ride' : 'rides';
  const tail = [races ? `${races} race${races === 1 ? '' : 's'}` : '', `${hours.toFixed(1)} h`, load ? `load ${load}` : ''].filter(Boolean);
  return {
    summary: [`Pulled ${activities.length} ${noun} from intervals.icu`, formatRange(start, end), tail.join(', ')].join(' · '),
    rows: activities.map(rowFor),
  };
}

/** One rating for the model: date, what it was, how it felt, and ids to look further. */
export function formatFeedbackForModel(f: SessionFeedback): string {
  const ids = [f.workoutId ? `workout ${f.workoutId}` : '', f.eventId ? `event ${f.eventId}` : 'unplanned ride', f.activityId ? `activity ${f.activityId}` : '']
    .filter(Boolean)
    .join(', ');
  return `${f.date} · ${f.title} · ${describeFeedback(f)} · ${ids}`;
}

/** "VO2 5x4 (workout w1): 3 rated, RPE 4, 5, 4 (newest first)" — the trend per session. */
export function feedbackRollup(ratings: readonly SessionFeedback[]): string[] {
  const groups = new Map<string, { label: string; rpes: number[] }>();
  for (const f of ratings) {
    const key = f.workoutId ?? `title:${f.title}`;
    const g = groups.get(key) ?? { label: f.workoutId ? `${f.title} (workout ${f.workoutId})` : f.title, rpes: [] };
    g.rpes.push(f.rpe);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => `- ${g.label}: ${g.rpes.length} rated, RPE ${g.rpes.join(', ')}${g.rpes.length > 1 ? ' (newest first)' : ''}`);
}

const rangeSchema = z.object({
  start: isoDateSchema.describe('First local date to include, YYYY-MM-DD.'),
  end: isoDateSchema.describe('Last local date to include, YYYY-MM-DD.'),
});

const replacesSchema = z
  .string()
  .optional()
  .describe('When revising a card the athlete asked you to change: its proposal id. The old card is closed so only this one can be applied.');

const PERIOD_LABEL: Record<PowerCurvePeriod, string> = {
  '90d': '90 days',
  season: 'this season',
  '1y': '1 year',
  allTime: 'all-time',
};

const CURVE_DURATIONS = [5, 15, 30, 60, 120, 180, 300, 480, 720, 1200, 3600];

const foodUnavailable = (): ToolOutcome => ({
  content: 'Meal ideas and recipes need the food module, which is not available on the server (CLAUDE_API_KEY for the food model). Answer in plain text instead and say the numbers are not computed.',
  isError: true,
});

/** "720 kcal · P 52 g · C 78 g · F 20 g" */
export const macrosForModel = (n: Nutrients) => `${Math.round(n.kcal)} kcal · P ${Math.round(n.protein)} g · C ${Math.round(n.carbs)} g · F ${Math.round(n.fat)} g`;

/** The draft's problems, for the model to mention (it can't fix them — the athlete picks in the pane). */
function draftIssues(d: Pick<RecipeDraft, 'ingredients'>): string[] {
  const unmatched = d.ingredients.filter((i) => i.problem === 'unmatched').map((i) => i.name);
  const unit = d.ingredients.filter((i) => i.problem === 'unit').map((i) => `${i.name} (${i.quantity} ${i.unit})`);
  return [
    unmatched.length ? `Not in their foods and no staple fits — not counted until they pick a food or remove it: ${unmatched.join(', ')}.` : '',
    unit.length ? `Matched, but the amount's unit doesn't fit their food — not counted until they fix the amount: ${unit.join(', ')}.` : '',
  ].filter(Boolean);
}

const mealIngredientsSchema = z
  .array(ingredientLineSchema)
  .min(1)
  .max(40)
  .describe('Every ingredient with an amount for the whole recipe. Prefer grams for solids and ml for liquids. Cooking fat counts — give it an amount.');

export const COACH_TOOLS = [
  defineTool({
    name: 'get_recent_activities',
    description:
      "Fetch the athlete's rides from intervals.icu between two local dates (inclusive, at most 120 days). One line per ride: id, start, type, name, moving time, distance, average and normalized power, intensity factor, training load, HR, cadence, intervals.icu's detected intervals, and the athlete's rating when they gave one (felt: RPE 1–10 and their note). Use this before advising on recent training, fatigue or what to ride.",
    schema: rangeSchema,
    source: 'data',
    runningLabel: 'Pulling rides from intervals.icu…',
    async run({ start, end }, { ports }) {
      if (!ports.training) return trainingUnavailable();
      if (daysBetween(start, end) < 0) return { content: 'end must be on or after start.', isError: true };
      if (daysBetween(start, end) > MAX_RANGE_DAYS) {
        return { content: `Range too long; ask for at most ${MAX_RANGE_DAYS} days.`, isError: true };
      }
      const activities = await ports.training.listActivities({ start, end });
      const felt = await feedbackByActivity(ports, activities);
      const chip = activityChip(activities, start, end);
      return {
        content: activities.length
          ? `${activities.length} activities ${start} → ${end} (newest first):\n${activities.map((a) => formatActivityForModel(a, felt.get(a.id))).join('\n')}`
          : `No activities between ${start} and ${end}.`,
        ui: { type: 'tool', toolUseId: '', name: 'get_recent_activities', status: 'ok', summary: chip.summary, source: 'data', rows: chip.rows },
      };
    },
  }),

  defineTool({
    name: 'search_activities',
    description:
      "Search the athlete's activities by name (case-insensitive), or by tag when the query starts with #. Use for 'my last crit' or 'the spring fondo'. Same line format as get_recent_activities.",
    schema: z.object({ query: z.string().min(1).describe('e.g. "crit", "fondo", "#race".') }),
    source: 'data',
    runningLabel: 'Searching intervals.icu…',
    async run({ query }, { ports }) {
      if (!ports.training) return trainingUnavailable();
      const activities = await ports.training.searchActivities(query);
      const felt = await feedbackByActivity(ports, activities);
      return {
        content: activities.length ? `${activities.length} matches:\n${activities.map((a) => formatActivityForModel(a, felt.get(a.id))).join('\n')}` : 'No matching activities.',
        ui: {
          type: 'tool',
          toolUseId: '',
          name: 'search_activities',
          status: 'ok',
          summary: `Searched intervals.icu for “${query}” · ${activities.length} found`,
          source: 'data',
          rows: activities.map(rowFor),
        },
      };
    },
  }),

  defineTool({
    name: 'get_activity_detail',
    description:
      "Fetch one ride's detail from intervals.icu: summary metrics plus every detected interval (type, duration, average/normalized power, intensity, zone, cadence, HR). Set include_power_curve for the ride's best power from 5 s to 60 min. Use it to judge how a workout or race actually went.",
    schema: z.object({
      activity_id: z.string().describe('Activity id from get_recent_activities, e.g. "i123456789".'),
      include_power_curve: z.boolean().optional(),
    }),
    source: 'data',
    runningLabel: 'Reading ride from intervals.icu…',
    async run({ activity_id, include_power_curve }, { ports }) {
      if (!ports.training) return trainingUnavailable();
      const d = await ports.training.getActivityDetail(activity_id, { powerCurve: include_power_curve ?? false });
      const felt = await feedbackByActivity(ports, [d.activity]);
      const intervals = d.intervals.map(
        (i) =>
          `${i.type}${i.label ? ` "${i.label}"` : ''} ${formatStepDuration(i.durationSec)}${i.avgWatts ? ` avg ${i.avgWatts} W` : ''}${i.normalizedWatts ? ` NP ${i.normalizedWatts} W` : ''}${i.intensityPct ? ` (${i.intensityPct}% FTP)` : ''}${i.zone ? ` Z${i.zone}` : ''}${i.avgCadence ? ` ${Math.round(i.avgCadence)} rpm` : ''}${i.avgHr ? ` HR ${i.avgHr}` : ''}`,
      );
      const curve = d.powerCurve?.length
        ? `\nBest power this ride: ${d.powerCurve.map((p) => `${formatStepDuration(p.durationSec)} ${p.watts} W`).join(' · ')}`
        : '';
      return {
        content: `${formatActivityForModel(d.activity, felt.get(d.activity.id))}\nIntervals:\n${intervals.join('\n') || '(none detected)'}${curve}`,
        ui: { type: 'tool', toolUseId: '', name: 'get_activity_detail', status: 'ok', summary: `Read ${d.activity.name} from intervals.icu`, source: 'data', rows: intervals },
      };
    },
  }),

  defineTool({
    name: 'get_power_curve',
    description:
      "The athlete's best power for 5 s to 60 min from intervals.icu over rolling windows: '90d', 'season', '1y' and/or 'allTime'. Use for strengths/weaknesses, progress and setting targets.",
    schema: z.object({
      periods: z.array(z.enum(['90d', 'season', '1y', 'allTime'])).min(1).max(4),
    }),
    source: 'data',
    runningLabel: 'Pulling power curve from intervals.icu…',
    async run({ periods }, { ports }) {
      if (!ports.training) return trainingUnavailable();
      const curves = await ports.training.getPowerCurves(periods);
      const lines = curves.map((c) => {
        const pts = CURVE_DURATIONS.map((d) => c.points.find((p) => p.durationSec === d)).filter((p) => p !== undefined);
        return `${c.label} (${c.start} → ${c.end}): ${pts.map((p) => `${formatStepDuration(p.durationSec)} ${p.watts} W`).join(' · ')}`;
      });
      return {
        content: lines.join('\n') || 'No power data.',
        ui: {
          type: 'tool',
          toolUseId: '',
          name: 'get_power_curve',
          status: 'ok',
          summary: `Pulled ${periods.map((p) => PERIOD_LABEL[p]).join(', ')} power curve from intervals.icu`,
          source: 'data',
          rows: lines,
        },
      };
    },
  }),

  defineTool({
    name: 'get_fitness',
    description:
      "Daily fitness (CTL), fatigue (ATL), form (CTL − ATL) and ramp rate from intervals.icu for a date range (at most 120 days). Use to judge freshness before races and how fast load is building. Today's values are already in the context message.",
    schema: rangeSchema,
    source: 'data',
    runningLabel: 'Pulling fitness from intervals.icu…',
    async run({ start, end }, { ports }) {
      if (!ports.training) return trainingUnavailable();
      if (daysBetween(start, end) < 0 || daysBetween(start, end) > MAX_RANGE_DAYS) {
        return { content: `Use a range of 0–${MAX_RANGE_DAYS} days.`, isError: true };
      }
      const days = await ports.training.getFitness({ start, end });
      const lines = days.map(
        (d) => `${d.date} CTL ${d.ctl.toFixed(1)} · ATL ${d.atl.toFixed(1)} · form ${d.form.toFixed(1)}${d.rampRate !== undefined ? ` · ramp ${d.rampRate.toFixed(1)}` : ''}${d.weightKg ? ` · ${d.weightKg} kg` : ''}`,
      );
      return {
        content: lines.join('\n') || 'No fitness data in that range.',
        ui: { type: 'tool', toolUseId: '', name: 'get_fitness', status: 'ok', summary: `Pulled fitness ${formatRange(start, end)} from intervals.icu`, source: 'data', rows: lines },
      };
    },
  }),

  defineTool({
    name: 'get_calendar',
    description:
      "Read the athlete's training calendar for a date range outside what the per-turn context already shows (planned, done and skipped sessions, with ids, their rating of a done one when they gave it, and any time off).",
    schema: rangeSchema,
    source: 'app',
    async run({ start, end }, { ports }) {
      if (daysBetween(start, end) > 120) return { content: 'Range too long; at most 120 days.', isError: true };
      const [events, ratings, timeOff] = await Promise.all([ports.listCalendar(start, end), ports.listFeedback({ start, end }).catch(() => []), ports.listTimeOff(start, end)]);
      const felt = new Map(ratings.flatMap((f) => (f.eventId ? [[f.eventId, f] as const] : [])));
      const lines = [
        ...timeOff.map((t) => `Time off: ${describeTimeOff(t)}`),
        ...events.map((e) => {
          const rating = felt.get(e.id);
          return `${e.id} · ${e.date} · ${describeKind(e)} · ${e.type} · ${e.title}${e.durationMin ? ` · ${e.durationMin} min` : ''} · ${describeStatus(e)}${e.tentative ? ' (tentative)' : ''}${e.source === 'intervals' ? ' · added in intervals.icu' : ''}${rating ? ` · felt: ${describeFeedback(rating)}` : ''}`;
        }),
      ];
      return { content: lines.length ? lines.join('\n') : 'Nothing scheduled in that range.' };
    },
  }),

  defineTool({
    name: 'get_ride_feedback',
    description:
      "The athlete's own ratings of their rides between two local dates (at most 180 days), newest first: RPE 1–10 and their note, with the session and library workout each was. Ratings are optional, so not every ride has one. Use it to judge whether library workouts or an intensity have been feeling too easy or too hard over more than the last week or two — e.g. before building or scheduling workouts. Pass workout_id for one library workout.",
    schema: rangeSchema.extend({ workout_id: z.string().optional().describe('A library workout id, to see only its ratings.') }),
    source: 'app',
    runningLabel: 'Reading ride ratings…',
    async run({ start, end, workout_id }, { ports }) {
      if (daysBetween(start, end) < 0 || daysBetween(start, end) > FEEDBACK_MAX_DAYS) {
        return { content: `Use a range of 0–${FEEDBACK_MAX_DAYS} days.`, isError: true };
      }
      const ratings = await ports.listFeedback({ start, end, workoutId: workout_id });
      const range = formatRange(start, end);
      if (!ratings.length) {
        return {
          content: `No rated rides between ${start} and ${end}${workout_id ? ` for workout ${workout_id}` : ''}.`,
          ui: { type: 'tool', toolUseId: '', name: 'get_ride_feedback', status: 'ok', summary: `No ride ratings · ${range}`, source: 'app' },
        };
      }
      return {
        content: `${ratings.length} rated ride${ratings.length === 1 ? '' : 's'} ${start} → ${end} (newest first):\n${ratings.map(formatFeedbackForModel).join('\n')}\n\nBy session:\n${feedbackRollup(ratings).join('\n')}`,
        ui: {
          type: 'tool',
          toolUseId: '',
          name: 'get_ride_feedback',
          status: 'ok',
          summary: `Read ${ratings.length} ride rating${ratings.length === 1 ? '' : 's'} · ${range}`,
          source: 'app',
          rows: ratings.map((f) => `${formatLongDay(f.date)} · ${f.title} · ${describeFeedback(f)}`),
        },
      };
    },
  }),

  defineTool({
    name: 'propose_plan',
    tier: 'build',
    description:
      "Show the athlete a plan card of dated sessions they can add to their calendar one by one or all at once. Nothing is written until they confirm. Use for any multi-day plan or a recommended session for a specific day. Each item has a kind: 'workout' = a structured workout from their library (workoutId required — call create_workout first for a new one; platform 'zwift'); 'race' = a scheduled race, usually a Zwift race (type 'race', startTime HH:mm when known, priority A/B/C, default B); 'ride' = any other planned ride (Z2, group ride, eFondo, recovery spin) named for what it is. Workouts and races sync to their intervals.icu calendar and from there to Zwift once they add them; rides stay in this app.",
    schema: z.object({
      title: z.string().describe('Card heading, e.g. "Proposed plan".'),
      subtitle: z.string().optional().describe('e.g. "Oct 29 – Nov 8 · Zwift FTP 280 W · Z2 155–210 W".'),
      items: z.array(planItemSchema).min(1).max(31),
      replaces: replacesSchema,
    }),
    source: 'app',
    strict: false,
    async run({ title, subtitle, items, replaces }, { ports, toolUseId }) {
      const proposal = await ports.createProposal({
        kind: 'plan',
        toolUseId,
        title,
        ...(subtitle ? { subtitle } : {}),
        ...(replaces ? { replaces } : {}),
        items,
      });
      return {
        content: `Plan card shown to the athlete with ${items.length} sessions (proposal ${proposal.id}). Not on the calendar until they add them.`,
        ui: { type: 'proposal', proposalId: proposal.id, kind: 'plan' },
      };
    },
  }),

  defineTool({
    name: 'propose_calendar_changes',
    tier: 'build',
    description:
      'Propose changes to sessions already on the calendar (move, update, remove) or single additions. Uses event ids from the calendar context. The athlete confirms before anything changes.',
    schema: z.object({
      title: z.string().describe('Short heading, e.g. "Swap Thursday and Friday".'),
      changes: z.array(calendarChangeSchema).min(1).max(20),
      replaces: replacesSchema,
    }),
    source: 'app',
    strict: false,
    async run({ title, changes, replaces }, { ports, toolUseId }) {
      const proposal = await ports.createProposal({
        kind: 'calendar_changes',
        toolUseId,
        title,
        ...(replaces ? { replaces } : {}),
        items: changes,
      });
      return {
        content: `Change card shown to the athlete with ${changes.length} change(s) (proposal ${proposal.id}). Nothing has changed yet.`,
        ui: { type: 'proposal', proposalId: proposal.id, kind: 'calendar_changes' },
      };
    },
  }),

  defineTool({
    name: 'propose_time_off',
    description:
      "Put days the athlete won't train on their calendar as vacation or sick, or change or remove such an entry, whenever they tell you about them. Give your best last day when they don't say; it can be changed later. Sessions still planned on those days are added to the card automatically as rows offering to remove them, so don't list or propose those removals yourself. To change an entry, pass its id and what's different. The athlete confirms before anything changes.",
    schema: z.object({
      title: z.string().describe('Short heading, e.g. "Sick until Sunday".'),
      action: z.enum(['add', 'update', 'remove']),
      time_off_id: z.string().optional().describe('For update and remove: the id from the time off context.'),
      kind: timeOffKindSchema.optional().describe('Required for add.'),
      start: isoDateSchema.optional().describe('First day, YYYY-MM-DD. Required for add.'),
      end: isoDateSchema.optional().describe('Last day, included, YYYY-MM-DD. Required for add.'),
      note: z.string().max(500).optional().describe('Only what they said worth keeping, e.g. "Head cold".'),
      replaces: replacesSchema,
    }),
    source: 'app',
    strict: false,
    async run({ title, action, time_off_id, kind, start, end, note, replaces }, { ports, toolUseId, today }) {
      const was = action === 'add' ? null : time_off_id ? await ports.getTimeOff(time_off_id) : null;
      if (action !== 'add' && !was) return { content: `No time off with id ${time_off_id ?? '(none given)'}. Use an id from the time off context.`, isError: true };
      const fields = was ? { kind: was.kind, startDate: was.startDate, endDate: was.endDate, ...(was.note ? { note: was.note } : {}) } : null;
      let changes: ProposalChange[];
      let summary: string;
      if (action === 'remove') {
        changes = [{ op: 'time_off_remove', timeOffId: was!.id, was: fields! }];
        summary = `removing ${describeTimeOff(was!)}`;
      } else {
        const parsed = timeOffInputSchema.safeParse({
          ...fields,
          ...(kind ? { kind } : {}),
          ...(start ? { startDate: start } : {}),
          ...(end ? { endDate: end } : {}),
          ...(note ? { note } : {}),
        });
        if (!parsed.success) return { content: `Invalid time off: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, isError: true };
        const entry = parsed.data;
        const sessions = sessionsInSpan(await ports.listCalendar(entry.startDate, entry.endDate), entry.startDate, entry.endDate, today);
        changes = [
          was ? { op: 'time_off_update', timeOffId: was.id, entry, was: fields! } : { op: 'time_off_add', entry },
          ...sessions.map((e) => ({ op: 'remove' as const, eventId: e.id })),
        ];
        const offer = sessions.length ? `, with rows offering to remove ${sessions.map((e) => `${e.title} (${e.date})`).join(', ')}` : '';
        summary = `${TIME_OFF_LABEL[entry.kind]} ${entry.startDate} → ${entry.endDate}${offer}`;
      }
      const proposal = await ports.createProposal({ kind: 'calendar_changes', toolUseId, title, ...(replaces ? { replaces } : {}), items: changes });
      return {
        content: `Card shown to the athlete: ${summary} (proposal ${proposal.id}). Nothing has changed yet, and they can skip any row.`,
        ui: { type: 'proposal', proposalId: proposal.id, kind: 'calendar_changes' },
      };
    },
  }),

  defineTool({
    name: 'propose_profile_update',
    description:
      'Propose updating the athlete’s FTP, their monthly Zwift weight, their training preference (steady, committed or all_in), or a power best they report (e.g. an outdoor effort intervals.icu doesn’t have). Body weight is synced from intervals.icu and is not proposed. Shown as a confirm card; nothing changes until they accept.',
    schema: profileUpdateSchema,
    source: 'app',
    strict: false,
    async run(update, { ports, toolUseId }) {
      const proposal = await ports.createProposal({
        kind: 'profile_update',
        toolUseId,
        title: 'Update profile',
        items: [update],
      });
      return {
        content: `Profile update card shown to the athlete (proposal ${proposal.id}). Not applied until they confirm.`,
        ui: { type: 'proposal', proposalId: proposal.id, kind: 'profile_update' },
      };
    },
  }),

  defineTool({
    name: 'propose_goal',
    description:
      "Propose a new goal, or changes to an existing one (pass goalId from the Goals section). Make goals measurable when it fits, by naming a measure and a target — never a current value; the app computes progress live. Measures: {kind:'wkg', weight:'zwift'|'trend'} (FTP ÷ Zwift baseline or trend weight — Zwift categories use 'zwift'), {kind:'ftp'}, {kind:'zwift_wkg', metric:'zftp'|'zmap'} (Zwift's zFTP or zMAP ÷ Zwift weight — what Zwift Racing League categories use; prefer zftp for category goals), {kind:'power_best', durationSec, period:'90d'|'season'|'allTime'}, {kind:'weight'} (trend weight, lower is better), {kind:'fitness'} (CTL), {kind:'manual', current, unit} for anything the app can't see. Goals like an event to finish can have no measure. Only two kinds of goal have a date: an event (event: true, targetDate is the event's date) and a weight goal (targetDate is optional and sets the calorie pace). Every other goal is open-ended, so leave targetDate out. Shown as a card; nothing changes until the athlete confirms.",
    schema: goalProposalSchema,
    source: 'app',
    strict: false,
    async run(goal, { ports, toolUseId }) {
      const proposal = await ports.createProposal({
        kind: 'goal',
        toolUseId,
        title: goal.goalId ? 'Update goal' : 'New goal',
        items: [goal],
      });
      return {
        content: `Goal card shown to the athlete (proposal ${proposal.id}). Not saved until they confirm.`,
        ui: { type: 'proposal', proposalId: proposal.id, kind: 'goal' },
      };
    },
  }),

  defineTool({
    name: 'create_workout',
    tier: 'build',
    description:
      'Create a structured Zwift workout and save it to the athlete’s library (they can download the .zwo). Segments: steady {durSec, pct}, ramp {durSec, fromPct, toPct}, repeat {count, steps: [{durSec, pct}]}. pct is integer % FTP. Pass basedOnId when revising an existing library workout.',
    schema: workoutInputSchema.omit({ inZwift: true }),
    source: 'app',
    strict: false,
    async run(input, { ports }) {
      const workout = await ports.createWorkout({ ...input, inZwift: false });
      return {
        content: `Saved "${workout.name}" to the library (id ${workout.id}). A workout card with a .zwo download is shown to the athlete.`,
        ui: { type: 'workout', workoutId: workout.id },
      };
    },
  }),

  defineTool({
    name: 'remember',
    description:
      "Save a note about the athlete, when they ask you to or when something they mention would change coaching in the days ahead, even if they play it down: a niggle, feeling run down, a busy spell. Days they won't train because they're away or sick go on the calendar with propose_time_off, not here. Not for small talk or ride-by-ride numbers, which are fetched fresh. Keep to what they said, without your own guesses, and write it as a plain note with no name or pronoun. Choose a list with until. Short-term, for anything with an end (a busy week, a temporary niggle): until is the last day it matters, and the note is forgotten the day after. Give your best date when they don't say. Long-term, for durable facts (schedule patterns, preferences, equipment, lasting injuries, constraints): until is null. Write the note so it still reads right later, with absolute dates: \"Big work deadline Wed Nov 11\", never \"next Wednesday\". If a note already covers this, use update_memory instead. The athlete can see and undo it.",
    schema: z.object({
      text: z.string().min(1).max(500),
      until: isoDateSchema.nullable().describe('Last local day it matters, YYYY-MM-DD, for a short-term note. null for a long-term note.'),
    }),
    source: 'app',
    async run({ text, until }, { ports }) {
      const memory = await ports.remember({ text, ...(until ? { until } : {}) });
      if ('error' in memory) return { content: memory.error, isError: true };
      return {
        content: `Saved ${until ? `as a short-term note until ${until}` : 'to long-term memory'} (id ${memory.id}).`,
        ui: { type: 'memory', memoryId: memory.id, action: 'remember', text: memory.text, ...(memory.until ? { until: memory.until } : {}) },
      };
    },
  }),

  defineTool({
    name: 'update_memory',
    description:
      "Change a saved note, by its id from either memory list, when a fact changes rather than ends: reword it, move its date, or switch its list. Prefer this to saving a near-duplicate. Keep absolute dates in the text. The athlete can see and undo it.",
    schema: z.object({
      memory_id: z.string(),
      text: z.string().min(1).max(500).optional().describe('The new wording. Leave out to keep it.'),
      until: isoDateSchema
        .nullable()
        .optional()
        .describe('Last local day it matters, YYYY-MM-DD, which makes it short-term. null makes it long-term. Leave out to keep it.'),
    }),
    source: 'app',
    strict: false,
    async run({ memory_id, text, until }, { ports }) {
      if (text === undefined && until === undefined) return { content: 'Nothing to change: give text, until or both.', isError: true };
      const result = await ports.updateMemory(memory_id, {
        ...(text !== undefined ? { text } : {}),
        ...(until ? { until } : {}),
        ...(until === null ? { unset: ['until' as const] } : {}),
      });
      if (!result) return { content: `No memory with id ${memory_id}.`, isError: true };
      if ('error' in result) return { content: result.error, isError: true };
      const { memory, previous } = result;
      return {
        content: `Updated memory ${memory_id}.`,
        ui: {
          type: 'memory',
          memoryId: memory.id,
          action: 'update',
          text: memory.text,
          ...(memory.until ? { until: memory.until } : {}),
          previous: { text: previous.text, ...(previous.until ? { until: previous.until } : {}) },
        },
      };
    },
  }),

  defineTool({
    name: 'forget',
    description: 'Remove a saved note that is no longer true, by its id from either memory list.',
    schema: z.object({ memory_id: z.string() }),
    source: 'app',
    async run({ memory_id }, { ports }) {
      const memory = await ports.forget(memory_id);
      if (!memory) return { content: `No memory with id ${memory_id}.`, isError: true };
      return {
        content: `Forgot memory ${memory_id}.`,
        ui: { type: 'memory', memoryId: memory.id, action: 'forget', text: memory.text, ...(memory.until ? { until: memory.until } : {}) },
      };
    },
  }),

  defineTool({
    name: 'find_events',
    description:
      "Search upcoming Zwift events (races, group rides, group workouts, TTs) from the app's synced copy — about the next day, or about a week when the athlete has used \"Get more events\". Results already know which pens they may enter (from their zFTP/zMAP/Racing Score) and estimate ride time. To put one on their calendar, propose it with propose_plan (race kind for races and TTs, ride for group rides), passing zwiftEventId and zwiftPenId from the result and its start time.",
    schema: z.object({
      day: z.enum(['all', 'today', 'tomorrow']).optional().describe("Local day; default all."),
      types: z.array(zwiftEventTypeSchema).optional().describe('Event types; empty or absent = all.'),
      min_km: z.number().optional().describe('Shortest distance, km.'),
      max_km: z.number().optional().describe('Longest distance, km.'),
      min_minutes: z.number().optional().describe('Shortest estimated ride time, minutes.'),
      max_minutes: z.number().optional().describe('Longest estimated ride time, minutes.'),
      terrain: z.array(z.enum(terrains)).optional(),
      fits_z2: z.boolean().optional().describe('Only group rides with a pace group inside their Z2 W/kg.'),
      can_enter: z.boolean().optional().describe('Hide events they cannot enter. Default true.'),
      search: z.string().optional().describe('Words in the name, route, world, series or description.'),
      sort: z.enum(eventSorts).optional().describe('start (default), pop (most signed up), km (longest), elev (most climbing).'),
      limit: z.number().int().min(1).max(25).optional().describe('At most 25; default 10.'),
    }),
    source: 'app',
    runningLabel: 'Searching Zwift events',
    async run(input, { ports }) {
      const filters = eventFiltersSchema.parse({
        day: input.day,
        types: input.types,
        terrain: input.terrain,
        fitsZ2: input.fits_z2,
        canEnter: input.can_enter,
        q: input.search?.slice(0, 100),
        ...(input.min_minutes !== undefined || input.max_minutes !== undefined
          ? { lengthUnit: 'min', lengthMin: input.min_minutes, lengthMax: input.max_minutes }
          : { lengthMin: input.min_km, lengthMax: input.max_km }),
      });
      const { result, timeZone } = await ports.findEvents({ filters, sort: input.sort ?? 'start', offset: 0, limit: input.limit ?? 10 });
      if (!result.all) return { content: 'No Zwift events are synced yet (the public feed syncs hourly).' };
      const when = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const lines = result.items.map((e) => {
        const mine = e.pens.find((p) => p.id === e.me.myPenId);
        const shown = mine ?? e.pens[0];
        const km = e.penKind === 'distance' ? e.pens.map((p) => `${p.name} ${p.km ?? '?'} km`).join(' / ') : shown?.km !== undefined ? `${shown.km} km · ${shown.ascentM ?? 0} m` : shown?.durationMin ? `${shown.durationMin} min` : '';
        const est = shown?.estMin ? ` · ~${shown.estMin} min` : '';
        const enter = e.me.canEnter === false ? " · they can't enter" : e.me.canEnter === null ? ' · pen rules unclear, check in Zwift' : mine ? ` · their pen ${mine.name}${e.me.basis && e.me.basis !== 'open' ? ` (${e.me.basis === 'zftp' ? 'zFTP' : 'Racing Score'})` : ''}` : '';
        const pace = e.penKind === 'pace' ? ` · pace ${e.pens.map((p) => (p.paceFrom ? `${p.name} ${p.paceFrom}–${p.paceTo} W/kg` : p.name)).join(', ')}` : '';
        const flags = [e.me.fitsZ2 && 'fits Z2', e.rules.includes('NO_POWERUPS') && 'no power-ups', e.categoryEnforced && 'category enforced', e.me.signedUpPenIds.length && 'they are signed up', e.me.calendarEventId && 'on their calendar']
          .filter(Boolean)
          .join(', ');
        return `${when.format(new Date(e.start))} · ${e.type} · ${e.name} · ${[e.world, e.route && `${e.route}${e.laps && e.laps > 1 ? ` × ${e.laps}` : ''}`].filter(Boolean).join(' · ')} · ${km}${est}${pace}${enter} · ${e.signedUp} signed up${flags ? ` · ${flags}` : ''} · zwiftEventId ${e.id}, zwiftPenId ${(mine ?? e.pens[0])?.id ?? '-'}`;
      });
      const summary = `Found ${result.total} Zwift event${result.total === 1 ? '' : 's'}`;
      return {
        content: lines.length ? `${summary}${result.total > lines.length ? ` (showing ${lines.length})` : ''}:\n${lines.join('\n')}` : `No events match (of ${result.all} synced).`,
        ui: { type: 'tool', toolUseId: '', name: 'find_events', status: 'ok', summary: `${summary} in the synced feed`, source: 'app', rows: lines },
      };
    },
  }),

  defineTool({
    name: 'suggest_meals',
    description:
      "Show the athlete meal idea cards (usually 3) when they ask what to eat or cook. Write each idea's ingredients with amounts for the number of servings; the app matches them to their own foods (or Canadian staples) and computes kcal and macros — the result tells you the numbers, use those and never estimate nutrition yourself. Tag each idea with why it's on the list (\"Best fit\", \"Fastest\", \"Most protein\", \"Carbs for tomorrow\"). Follow-ups are short chips they can tap (\"More ideas\", \"Make it vegetarian\", \"Higher protein\", \"Under 20 min\"). Nothing is saved; when they pick one, call build_recipe.",
    schema: z.object({
      slot: z.string().min(1).max(30).describe('The meal it is for — one of their meal slots (Breakfast, Lunch, Dinner, Workout fuel, Snacks).'),
      date: isoDateSchema.describe('The day it is for, YYYY-MM-DD.'),
      ideas: z
        .array(
          z.object({
            tag: z.string().min(1).max(30),
            name: z.string().min(1).max(80),
            description: z.string().min(1).max(160).describe('One line: what it is.'),
            minutes: z.number().int().min(1).max(600).describe('Total time to make it.'),
            servings: z.number().positive().max(12).describe('Servings the ingredient amounts make — usually 1 or 2.'),
            ingredients: mealIngredientsSchema,
            difficulty: z.enum(mealDifficulties).optional(),
            equipment: z.array(z.string().min(1).max(30)).max(4).optional().describe('Pans and appliances, e.g. ["pan", "rice pot"].'),
            leftovers: z.string().min(1).max(60).optional().describe('e.g. "none (1 serving)" or "sauce keeps 3 days".'),
            why: z
              .string()
              .min(1)
              .max(300)
              .optional()
              .describe("Two sentences on why it fits their day (training, carbs, fat, room for a snack). No kcal or macro numbers — the app computes those after this call."),
            steps: z.array(z.string().min(1).max(160)).min(2).max(5).optional().describe('3–5 short preview steps, without numbers. The full recipe comes from build_recipe.'),
          }),
        )
        .min(1)
        .max(4),
      follow_ups: z.array(z.string().min(1).max(40)).max(4),
      kcal_range: z
        .object({ min: z.number().int().min(0).max(5000), max: z.number().int().min(0).max(5000) })
        .optional()
        .describe('Only when they name a calorie range for the meal ("650–800 calories").'),
    }),
    source: 'app',
    strict: false,
    async run({ slot, date, ideas, follow_ups, kcal_range }, { ports, toolUseId }) {
      if (!ports.food) return foodUnavailable();
      const saved = await ports.food.createMealIdeas({ toolUseId, slot, date, ideas, followUps: follow_ups, kcalRange: kcal_range });
      const lines = saved.ideas.map((idea, i) => {
        const nums = idea.perServing ? `${macrosForModel(idea.perServing)} per serving` : 'could not be priced';
        const missing = idea.unpriced.length ? ` (not counted: ${idea.unpriced.join(', ')})` : '';
        return `${i}. ${idea.name} — ${nums}${missing}`;
      });
      return {
        content: `Idea cards shown to the athlete (ideas ${saved.id}), priced from their foods and staples:\n${lines.join('\n')}\nWhen they pick one, call build_recipe with ideas_id ${saved.id} and its idea_index.`,
        ui: { type: 'meal_ideas', ideasId: saved.id },
      };
    },
  }),

  defineTool({
    name: 'build_recipe',
    description:
      "Build a full recipe for the athlete to cook — after they pick a meal idea, or when they ask for a recipe. Not for logging something they ate: that's offer_food_log, even when it's home-made. Give every ingredient with an amount for the whole recipe, and the method as steps (the app numbers them). Use the servings they asked for (\"…, 3 servings\"). The app matches ingredients to their foods (or Canadian staples) and computes per-serving nutrition; the result tells you the numbers. It opens in a recipe pane where they can save it to their recipes, or log how much they ate. Nothing is saved or logged by this call.",
    schema: z.object({
      ideas_id: z.string().optional().describe('The ideas id from suggest_meals, when building one of those ideas.'),
      idea_index: z.number().int().min(0).max(3).optional(),
      name: z.string().min(1).max(80),
      description: z.string().max(160).optional(),
      servings: z.number().positive().max(12).describe('Servings the recipe makes.'),
      minutes: z.number().int().min(1).max(600).optional(),
      ingredients: mealIngredientsSchema,
      steps: z
        .array(z.string().min(1).max(400))
        .min(1)
        .max(20)
        .describe(
          'The method, in order, without numbers — one action per step, imperative. Refer to ingredients by name, never by amount ("add the rice", not "add 150 g rice"): the app scales amounts when they cook for more people. Bold the heat, time and doneness cues with **…** ("Sear on **medium-high**, **4–5 min** a side, until **golden**"). No other markdown.',
        ),
    }),
    source: 'app',
    strict: false,
    async run(input, { ports, toolUseId }) {
      if (!ports.food) return foodUnavailable();
      const draft = await ports.food.createRecipeDraft({
        toolUseId,
        ideasId: input.ideas_id,
        ideaIndex: input.idea_index,
        name: input.name,
        description: input.description,
        servings: input.servings,
        minutes: input.minutes,
        ingredients: input.ingredients,
        steps: input.steps,
      });
      const staples = draft.totals.staples.length ? `Staples used (from the Canadian Nutrient File — saved to their foods when they log or save): ${draft.totals.staples.join(', ')}.` : '';
      return {
        content: [
          `Recipe card shown and opened in the recipe pane (draft ${draft.id}). ${draft.servings} serving${draft.servings === 1 ? '' : 's'}; per serving ${macrosForModel(draft.totals.perServing)}${draft.totals.unresolved ? ' so far' : ''}.`,
          staples,
          ...draftIssues(draft),
          'Not logged or saved yet — the athlete chooses how much they ate in the pane.',
        ]
          .filter(Boolean)
          .join('\n'),
        ui: { type: 'recipe_ref', draftId: draft.id },
      };
    },
  }),

  defineTool({
    name: 'offer_food_log',
    description:
      'Put a Log this button in the chat when the athlete asks you to log food ("log my lunch", "add a latte") or tells you what they ate so it counts ("I had a burrito for lunch, how\'s my protein?"). You can\'t log food yourself: the button opens the app\'s food logger with their words, and they check it and log it there. Use this instead of build_recipe or suggest_meals, even for something home-made. Not for a passing mention ("big dinner last night, legs feel heavy"). One call per meal. A recipe you built in this chat is logged from its pane, so tell them that instead.',
    schema: z.object({
      phrase: z.string().min(2).max(500).describe('The athlete\'s words for this meal, unchanged, with any amounts, meal and day ("yesterday", "for breakfast").'),
    }),
    source: 'app',
    strict: false,
    async run({ phrase }) {
      return {
        content:
          "Log this button shown with their words. Nothing is logged until they confirm it in the food logger, and the Food line won't count it until then. The card already says how to log directly next time, so don't repeat that. Give no numbers for this food.",
        ui: { type: 'food_log_offer', phrase },
      };
    },
  }),
] as const;

export type CoachToolName = (typeof COACH_TOOLS)[number]['name'];

/**
 * API tool definitions, generated once from the Zod schemas. Order and content are deterministic —
 * tools render first in the prompt, so any change here invalidates every cached prefix.
 */
export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = COACH_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: toStrictSchema(
    z.toJSONSchema(t.schema, { io: 'input', reused: 'ref' }) as Record<string, unknown>,
  ) as Anthropic.Beta.BetaTool['input_schema'],
  strict: t.strict !== false,
  eager_input_streaming: true,
}));

/**
 * Identifies this exact tool list, descriptions included (FNV-1a, so `app.ts` stays Node-free). Replayed
 * thinking is tied to the tools it was written with, so a chat restarts when this changes (DECISIONS #80).
 */
export const TOOLS_HASH: string = (() => {
  let hash = 0x811c9dc5;
  for (const ch of JSON.stringify(TOOL_DEFINITIONS)) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
})();

export function findTool(name: string) {
  return COACH_TOOLS.find((t) => t.name === name);
}

/**
 * Validate and run one tool call. The parse is not optional: with eager input streaming the API no
 * longer validates inputs, and the SDK's tolerant parser can hand back a truncated object.
 */
export async function runTool(name: string, rawInput: unknown, ctx: ToolRunContext): Promise<ToolOutcome> {
  const tool = findTool(name);
  if (!tool) return { content: `Unknown tool ${name}.`, isError: true };
  const parsed = (tool.schema as z.ZodType).safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
      isError: true,
    };
  }
  try {
    const outcome = await (tool as CoachTool<z.ZodType>).run(parsed.data, ctx);
    if (outcome.ui?.type === 'tool') outcome.ui = { ...outcome.ui, toolUseId: ctx.toolUseId };
    return outcome;
  } catch (err) {
    // Tool failures go back to the model as is_error results so it can explain or retry; they must
    // not abort the turn.
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `${name} failed: ${message}`,
      isError: true,
      ...(tool.source === 'data'
        ? { ui: { type: 'tool' as const, toolUseId: ctx.toolUseId, name, status: 'error' as const, summary: `intervals.icu request failed`, source: 'data' as const } }
        : {}),
    };
  }
}

