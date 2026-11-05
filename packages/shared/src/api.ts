import type { CalendarEvent } from './calendar';
import type { Proposal, ThreadSummary, UiMessage } from './coach';
import type { MealIdeas, RecipeDraft } from './coach-food';
import type { IsoDate } from './common';
import type { SessionFeedback } from './feedback';
import type { Goal, Memory, PowerBest, Profile } from './profile';
import type { CalendarActivity, FitnessDay, IntegrationStatus } from './training';
import type { Workout } from './workout';

/** Response shapes shared by the API and the web app. */

export interface ProfilePayload {
  profile: Profile;
  powerBests: PowerBest[];
  goals: Goal[];
  memories: Memory[];
}

/** One weigh-in and the 7-day trend weight as of that day (core.trendSeries). */
export interface WeightPoint {
  date: IsoDate;
  kg: number;
  trendKg: number;
}

/** The last 90 days of weigh-ins from intervals.icu, oldest first; empty without intervals.icu. */
export interface WeightHistoryPayload {
  points: WeightPoint[];
}

export interface ThreadView {
  thread: ThreadSummary;
  messages: UiMessage[];
  /** Messages the coach started afresh from: it has only a recap of what's above them (DECISIONS #80). */
  contextBreaks: string[];
  /** Big enough to suggest a new chat. */
  contextLong: boolean;
  proposals: Proposal[];
  /** Workouts referenced by workout cards in this thread (may include archived ones). */
  workouts: Workout[];
  /** Meal idea cards and generated recipes in this thread. */
  mealIdeas: MealIdeas[];
  recipeDrafts: RecipeDraft[];
}

/** Everything the coach screen's right rail needs in one request. */
export interface DashboardPayload {
  today: IsoDate;
  timezone: string;
  /** Today's sessions (usually one). */
  todayEvents: CalendarEvent[];
  /** Monday-start week containing today. */
  week: { date: IsoDate; events: CalendarEvent[] }[];
  /** The next planned race after today, within four weeks (the mobile Today strip). */
  nextRace?: { date: IsoDate; title: string } | undefined;
  snapshot: {
    /** Unset until the athlete knows it (a ramp test is booked; DECISIONS #62). */
    ftpZwift?: number | undefined;
    /** Trend weight (or manual). */
    weightKg: number;
    weightLatest?: { kg: number; date: IsoDate } | undefined;
    zwiftWeightKg?: number | undefined;
    /** The Zwift weight syncs from Zwift, so the drift alert can't offer to set it here. */
    zwiftWeightSynced?: boolean | undefined;
    /** On the trend weight; unset without an FTP. */
    wattsPerKg?: number | undefined;
    best5minW?: number | undefined;
    /** Today's fitness from intervals.icu, when connected. */
    fitness?: FitnessDay | undefined;
  };
  mainGoal?: Goal | undefined;
  intervals: IntegrationStatus;
}

export interface UsagePayload {
  monthToDateUsd: number;
  /** Month to date on the chat and build routes. Calls from before routing are in neither. */
  chatUsd: number;
  buildUsd: number;
  calls: number;
  model: string;
  /** The build model, or null when one model does everything or this athlete can't use it now. */
  buildModel: string | null;
}

/** A calendar range: planned sessions plus every synced ride (DECISIONS #49). */
export interface CalendarPayload {
  events: CalendarEvent[];
  activities: CalendarActivity[];
  /** The athlete's ratings of the sessions and rides in the range. */
  feedback: SessionFeedback[];
}
