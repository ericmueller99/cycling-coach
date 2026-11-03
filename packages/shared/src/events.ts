import { z } from 'zod';

/**
 * Zwift events, synced into our own database and filtered locally (DECISIONS #29).
 * The public feed covers about the next day; "Get more events" adds about a week from the logged-in
 * feed. Nothing here is ever written to Zwift.
 */

export const zwiftEventTypes = ['race', 'group_ride', 'workout', 'tt', 'ttt'] as const;
export const zwiftEventTypeSchema = z.enum(zwiftEventTypes);
export type ZwiftEventType = z.infer<typeof zwiftEventTypeSchema>;

/**
 * What an event's pens are:
 * - `category` — race categories (zFTP/zMAP or Racing Score, enforced or open);
 * - `pace` — group-ride pace groups (W/kg ranges);
 * - `distance` — the pens are distance options (Long / Standard / Short), open to all;
 * - `none` — one start, no choice (TTs, most workouts).
 */
export const penKinds = ['category', 'pace', 'distance', 'none'] as const;
export type PenKind = (typeof penKinds)[number];

/** From metres climbed per km: flat < 5, rolling 5–10, hilly 10–20, mountain 20+. */
export const terrains = ['flat', 'rolling', 'hilly', 'mountain'] as const;
export type Terrain = (typeof terrains)[number];

export const unlockKinds = ['kit', 'badge', 'route_badge', 'bike'] as const;
export type UnlockKind = (typeof unlockKinds)[number];

export const eventSeries = ['zrl', 'tour_of_watopia', 'zfondo', 'pacer'] as const;
export type EventSeriesKey = (typeof eventSeries)[number];

export const timesOfDay = ['morning', 'midday', 'afternoon', 'evening'] as const;
export type TimeOfDay = (typeof timesOfDay)[number];

/** Pen letters as Zwift numbers them (`subgroup.label` 1–5). */
export const penLetters = ['A', 'B', 'C', 'D', 'E'] as const;
export type PenLetter = (typeof penLetters)[number];

export interface ZwiftEventPen {
  /** Zwift's subgroup id. */
  id: number;
  /** 1–5 = A–E. */
  label: number;
  /** What to show: "B", or the option name for distance pens ("Long"). */
  name: string;
  /** UTC ISO start of this pen. */
  start: string;
  routeId?: number | undefined;
  route?: string | undefined;
  laps?: number | undefined;
  /** Lead-in + laps × route, or the pen's own distance. Absent when the route is unknown. */
  km?: number | undefined;
  ascentM?: number | undefined;
  terrain?: Terrain | undefined;
  /** A time-based pen (e.g. a 60 min ride). */
  durationMin?: number | undefined;
  /** W/kg range of a pace group. */
  paceFrom?: number | undefined;
  paceTo?: number | undefined;
  /** Zwift's own range label, e.g. "390-510" (Racing Score pens). */
  rangeLabel?: string | undefined;
  /** Zwift's access expression for this pen, when it has its own. */
  access?: string | undefined;
  rules: string[];
  signedUp: number;
  /** Estimated ride time in minutes — added per athlete when queried. */
  estMin?: number | undefined;
}

export interface ZwiftEvent {
  id: number;
  name: string;
  type: ZwiftEventType;
  /** UTC ISO start of the first pen. */
  start: string;
  world?: string | undefined;
  route?: string | undefined;
  laps?: number | undefined;
  description?: string | undefined;
  imageUrl?: string | undefined;
  categoryEnforced: boolean;
  /** Zwift's access expression for the event (who may enter which pen). */
  access?: string | undefined;
  rules: string[];
  tags: string[];
  series?: EventSeriesKey | undefined;
  seriesName?: string | undefined;
  signedUp: number;
  /** People the athlete follows who signed up (extended feed only). */
  friends: number;
  penKind: PenKind;
  pens: ZwiftEventPen[];
  kmMin?: number | undefined;
  kmMax?: number | undefined;
  ascentMin?: number | undefined;
  ascentMax?: number | undefined;
  unlocks: UnlockKind[];
  ranked: boolean;
  womenOnly: boolean;
  seenVia: 'public' | 'extended';
}

/** Per-athlete facts, worked out when the list is queried. */
export interface EventForMe {
  /** `true`/`false` when we could tell; `null` = "check pen rules in Zwift". */
  canEnter: boolean | null;
  /** The pen the athlete would ride (their category, or the first open pen). */
  myPenId?: number | undefined;
  /** What `myPenId` is based on. */
  basis?: 'zftp' | 'racing_score' | 'open' | undefined;
  /** Pens they may enter. */
  enterablePenIds: number[];
  /** Distance options that match the length/terrain filters. */
  matchedPenIds: number[];
  fitsZ2: boolean;
  signedUpPenIds: number[];
  /** The calendar session made from this event. */
  calendarEventId?: string | undefined;
}

export type EventItem = ZwiftEvent & { me: EventForMe };

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

/**
 * Every control in the filter rail. One schema for the page (it lives in the URL), saved searches,
 * `POST /api/events/query` and the coach's `find_events`. Never `.partial()` this: it carries
 * defaults (CLAUDE.md rule 1b).
 */
export const eventFiltersSchema = z.object({
  q: z.string().max(100).default(''),
  /** Hide events that have already started. Off = also those that started in the last hour (late join). */
  upcoming: z.boolean().default(true),
  day: z.enum(['all', 'today', 'tomorrow']).default('all'),
  timesOfDay: z.array(z.enum(timesOfDay)).default([]),
  /** Local start-time window, HH:mm. */
  from: hhmm.optional(),
  to: hhmm.optional(),
  /** Empty = every type. */
  types: z.array(zwiftEventTypeSchema).default([]),
  lengthUnit: z.enum(['km', 'min']).default('km'),
  lengthMin: z.number().min(0).optional(),
  lengthMax: z.number().min(0).optional(),
  terrain: z.array(z.enum(terrains)).default([]),
  worlds: z.array(z.string().max(40)).default([]),
  route: z.string().max(60).optional(),
  minSignedUp: z.number().int().min(0).default(0),
  friends: z.boolean().default(false),
  canEnter: z.boolean().default(true),
  fitsZ2: z.boolean().default(false),
  hasUnlock: z.boolean().default(false),
  pens: z.array(z.enum(penLetters)).default([]),
  penKinds: z.array(z.enum(penKinds)).default([]),
  penBasis: z.enum(['any', 'zftp', 'racing_score']).default('any'),
  enforcedOnly: z.boolean().default(false),
  rankedOnly: z.boolean().default(false),
  powerups: z.enum(['any', 'yes', 'no']).default('any'),
  lateJoin: z.boolean().default(false),
  noDrafting: z.boolean().default(false),
  ttBikes: z.boolean().default(false),
  hrmRequired: z.boolean().default(false),
  hideWomenOnly: z.boolean().default(true),
  unlocks: z.array(z.enum(unlockKinds)).default([]),
  series: z.array(z.enum(eventSeries)).default([]),
  signedUpOnly: z.boolean().default(false),
  onCalendar: z.boolean().default(false),
});
export type EventFilters = z.infer<typeof eventFiltersSchema>;
export type EventFiltersInput = z.input<typeof eventFiltersSchema>;

export const DEFAULT_EVENT_FILTERS: EventFilters = eventFiltersSchema.parse({});

export const eventSorts = ['start', 'pop', 'km', 'elev'] as const;
export type EventSort = (typeof eventSorts)[number];

export const eventQuerySchema = z.object({
  filters: eventFiltersSchema.default(DEFAULT_EVENT_FILTERS),
  sort: z.enum(eventSorts).default('start'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(100),
});
export type EventQuery = z.infer<typeof eventQuerySchema>;
export type EventQueryInput = z.input<typeof eventQuerySchema>;

export interface EventQueryResult {
  items: EventItem[];
  /** Matches for these filters. */
  total: number;
  /** Every cycling event stored. */
  all: number;
  /** Counts per type and world under every other filter (each facet ignores its own filter). */
  facets: { types: { [K in ZwiftEventType]?: number | undefined }; worlds: Record<string, number> };
}

export interface ExtendedRunStatus {
  state: 'idle' | 'running' | 'error';
  pages: number;
  events: number;
  /** Start of the latest event the run reached. */
  through?: string | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  /** "Get more events" is refused until then (6 h after the last run). */
  nextAllowedAt?: string | undefined;
  error?: string | undefined;
}

export interface EventsStatus {
  /** `extended` while logged-in results cover later than the public feed. */
  source: 'public' | 'extended' | 'none';
  count: number;
  /** Start of the latest stored event. */
  through?: string | undefined;
  lastPublicSyncAt?: string | undefined;
  /** "Refresh" is refused until then (15 min after the last public sync). */
  refreshAllowedAt?: string | undefined;
  /** The last public sync failed; the list shows the previous one. */
  lastError?: string | undefined;
  /** Null when the server has no Zwift login (no "Get more events"). */
  extended: ExtendedRunStatus | null;
}

export type EventsRefreshResult = { kind: 'done' | 'busy' } | { kind: 'too_soon'; retryAt: string } | { kind: 'error'; error: string };

export type EventsExtendResult =
  | { kind: 'started' | 'running'; status: ExtendedRunStatus }
  | { kind: 'cooldown'; nextAllowedAt: string }
  | { kind: 'not_configured' };

export const savedSearchInputSchema = z.object({
  name: z.string().min(1).max(40),
  filters: eventFiltersSchema,
});
export type SavedSearchInput = z.infer<typeof savedSearchInputSchema>;

export interface SavedSearch {
  id: string;
  name: string;
  filters: EventFilters;
}
