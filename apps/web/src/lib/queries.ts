import type {
  CalendarEventInput,
  CalendarEventPatch,
  EventQuery,
  SavedSearchInput,
  GoalInput,
  GoalPatch,
  MemoryInput,
  MemoryPatch,
  MemoryRevert,
  OnboardingBody,
  OnboardingFitness,
  OnboardingGoals,
  OnboardingState,
  PowerBest,
  Profile,
  Proposal,
  SessionFeedbackInput,
  CourseInput,
  OutlookRevert,
  TimeOffInput,
  TimeOffPatch,
} from '@cycling-coach/shared';
import { addDays, daysBetween, weekStart } from '@cycling-coach/core';
import { keepPreviousData, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, ApiError, unwrap, updateName } from './api';

export const keys = {
  me: ['me'] as const,
  coachCheck: ['coach', 'check'] as const,
  authConfig: ['auth-config'] as const,
  onboarding: ['onboarding'] as const,
  dashboard: ['dashboard'] as const,
  profile: ['profile'] as const,
  weight: ['weight'] as const,
  workouts: ['workouts'] as const,
  workout: (id: string) => ['workouts', id] as const,
  threads: ['threads'] as const,
  thread: (id: string) => ['threads', id] as const,
  calendar: (from: string, to: string) => ['calendar', from, to] as const,
  timeOff: ['timeOff'] as const,
  outlook: ['outlook'] as const,
  intervals: ['intervals'] as const,
  zwift: ['zwift'] as const,
  usage: ['usage'] as const,
  events: (q: Omit<EventQuery, 'offset' | 'limit'>) => ['events', q] as const,
  eventsStatus: ['events', 'status'] as const,
  eventSearches: ['events', 'searches'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      const res = await api.api.me.$get();
      // 401 is the normal signed-out state, not an error worth retrying.
      if (res.status === 401) return null;
      return unwrap(res);
    },
    retry: false,
    staleTime: Infinity,
  });
}

/** What this server's sign-in offers: sign-up, password reset, email verification (DECISIONS #61). */
export function useAuthConfig() {
  return useQuery({
    queryKey: keys.authConfig,
    queryFn: async () => unwrap(await api.api['auth-config'].$get()),
    staleTime: Infinity,
  });
}

/** The onboarding wizard's saved state (DECISIONS #62). */
export function useOnboarding() {
  return useQuery({ queryKey: keys.onboarding, queryFn: async () => unwrap(await api.api.onboarding.$get()) });
}

/** Each step saves as the athlete continues; the answer is the new state. */
export function useOnboardingMutations() {
  const qc = useQueryClient();
  const onSuccess = (state: OnboardingState) => {
    qc.setQueryData(keys.onboarding, state);
    // The profile, goals, library and calendar change under the athlete's feet.
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'onboarding' && q.queryKey[0] !== 'me' && q.queryKey[0] !== 'auth-config' });
  };
  return {
    fitness: useMutation({ mutationFn: async (input: OnboardingFitness) => unwrap(await api.api.onboarding.fitness.$put({ json: input })), onSuccess }),
    body: useMutation({ mutationFn: async (input: OnboardingBody) => unwrap(await api.api.onboarding.body.$put({ json: input })), onSuccess }),
    goals: useMutation({ mutationFn: async (input: OnboardingGoals) => unwrap(await api.api.onboarding.goals.$put({ json: input })), onSuccess }),
    step: useMutation({ mutationFn: async (step: number) => unwrap(await api.api.onboarding.step.$put({ json: { step } })), onSuccess }),
    finish: useMutation({
      mutationFn: async () => unwrap(await api.api.onboarding.finish.$post()),
      onSuccess: (state) => {
        onSuccess(state);
        // Straight away, so the router lets the athlete into the app on the next navigation.
        qc.setQueryData(keys.me, (me: { onboarded: boolean } | null | undefined) => (me ? { ...me, onboarded: true } : me));
      },
    }),
    /** After a note is added or removed on the Memory step. */
    refresh: () => qc.invalidateQueries({ queryKey: keys.onboarding }),
  };
}

/** The Better Auth user's name (sidebar, coach). */
export function useUpdateName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateName,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: async () => unwrap(await api.api.dashboard.$get()) });
}

export function useProfile() {
  return useQuery({ queryKey: keys.profile, queryFn: async () => unwrap(await api.api.profile.$get()) });
}

/** 90 days of weigh-ins with their trend, from intervals.icu. */
export function useWeightHistory() {
  return useQuery({ queryKey: keys.weight, queryFn: async () => unwrap(await api.api.weight.$get()) });
}

export function useWorkouts() {
  return useQuery({ queryKey: keys.workouts, queryFn: async () => unwrap(await api.api.workouts.$get()) });
}

export function useWorkout(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.workout(id),
    queryFn: async () => unwrap(await api.api.workouts[':id'].$get({ param: { id } })),
    enabled,
  });
}

/** Remove a workout from the library (archived: cards and sessions that use it still render). */
export function useArchiveWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await api.api.workouts[':id'].$delete({ param: { id } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workouts }),
  });
}

/** How many chats a list shows at first, and how many "Show older" adds. */
export const THREADS_PAGE = 50;

/** Options, so a read that has to be fresh can use `fetchQuery` on the same cache entry. */
export const threadsQuery = (limit = THREADS_PAGE) => ({
  queryKey: [...keys.threads, limit] as const,
  queryFn: async () => unwrap(await api.api.threads.$get({ query: { limit: String(limit) } })),
});

export const threadQuery = (id: string) => ({
  queryKey: keys.thread(id),
  queryFn: async () => unwrap(await api.api.threads[':id'].$get({ param: { id } })),
});

export function useThreads(limit = THREADS_PAGE) {
  return useQuery({ ...threadsQuery(limit), placeholderData: keepPreviousData });
}

export function useThread(id: string | undefined) {
  return useQuery({
    ...threadQuery(id ?? 'none'),
    enabled: !!id,
  });
}

export function useProposal(id: string, initialData?: Proposal) {
  return useQuery({
    queryKey: ['proposals', id],
    queryFn: async () => unwrap(await api.api.proposals[':id'].$get({ param: { id } })),
    ...(initialData ? { initialData } : {}),
  });
}

/**
 * The scrolling calendar's range, fetched in fixed 4-week chunks from `start` (a Monday) so growing
 * the range only loads the new chunks — each request reads rides from intervals.icu live.
 */
export const CALENDAR_CHUNK_WEEKS = 4;

/**
 * The chunk start holding `week`, on the grid both calendar layouts use (chunks counted from
 * today's week), so paging the mobile agenda reads the same cache as the desktop grid.
 */
export function calendarChunkStart(today: string, week: string) {
  const base = weekStart(today);
  const days = CALENDAR_CHUNK_WEEKS * 7;
  return addDays(base, Math.floor(daysBetween(base, week) / days) * days);
}

export function useCalendarRange(start: string, weeks: number) {
  const chunks = Array.from({ length: Math.ceil(weeks / CALENDAR_CHUNK_WEEKS) }, (_, i) => {
    const from = addDays(start, i * CALENDAR_CHUNK_WEEKS * 7);
    return { from, to: addDays(from, CALENDAR_CHUNK_WEEKS * 7 - 1) };
  });
  return useQueries({
    queries: chunks.map(({ from, to }) => ({
      queryKey: keys.calendar(from, to),
      queryFn: async () => unwrap(await api.api.calendar.$get({ query: { from, to } })),
    })),
    combine: (results) => ({
      events: results.flatMap((r) => r.data?.events ?? []),
      activities: results.flatMap((r) => r.data?.activities ?? []),
      feedback: results.flatMap((r) => r.data?.feedback ?? []),
      error: results.find((r) => r.error)?.error ?? null,
      pending: results.some((r) => r.isPending),
    }),
  });
}

/** One range, not the calendar's chunks: an entry can run across them and would show up twice. */
export function useTimeOff(from: string, to: string) {
  const query = useQuery({
    queryKey: [...keys.timeOff, from, to],
    queryFn: async () => unwrap(await api.api['time-off'].$get({ query: { from, to } })),
    placeholderData: keepPreviousData,
  });
  return query.data ?? [];
}

/** The calendar for any range, for checking what's on some days; shares the cache with the grid's chunks. */
export function useSessionsBetween(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.calendar(from, to),
    queryFn: async () => unwrap(await api.api.calendar.$get({ query: { from, to } })),
    enabled,
  });
}

export function useTimeOffMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.timeOff });
  return {
    create: useMutation({
      mutationFn: async (input: TimeOffInput) => unwrap(await api.api['time-off'].$post({ json: input })),
      onSuccess: invalidate,
    }),
    patch: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: TimeOffPatch }) => unwrap(await api.api['time-off'][':id'].$patch({ param: { id }, json: patch })),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api['time-off'][':id'].$delete({ param: { id } })),
      onSuccess: invalidate,
    }),
  };
}

/** intervals.icu status; polls every 3 s while a full import runs so its progress bar moves. */
export function useIntervals() {
  return useQuery({
    queryKey: keys.intervals,
    queryFn: async () => unwrap(await api.api.integrations.intervals.$get()),
    refetchInterval: (q) => (q.state.data?.fullSync?.status === 'running' ? 3000 : false),
  });
}

/** Everything that reads synced rides, wellness or curves — refreshed after a sync. */
function invalidateSynced(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: keys.dashboard });
  void qc.invalidateQueries({ queryKey: keys.profile });
  void qc.invalidateQueries({ queryKey: keys.weight });
  void qc.invalidateQueries({ queryKey: ['calendar'] });
  void qc.invalidateQueries({ queryKey: ['energy'] });
}

/**
 * Watches a running full import (mounted once, in the shell): while it runs, the screens that show
 * rides refresh every half minute as history fills in, and once more when it finishes.
 */
export function useFullSyncRefresh() {
  const qc = useQueryClient();
  const { data } = useIntervals();
  const running = data?.fullSync?.status === 'running';
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) invalidateSynced(qc);
    wasRunning.current = running;
    if (!running) return;
    const timer = setInterval(() => invalidateSynced(qc), 30_000);
    return () => clearInterval(timer);
  }, [running, qc]);
  return data?.fullSync;
}

export function useZwift() {
  return useQuery({ queryKey: keys.zwift, queryFn: async () => unwrap(await api.api.integrations.zwift.$get()) });
}

export function useUsage() {
  return useQuery({ queryKey: keys.usage, queryFn: async () => unwrap(await api.api.usage.$get()) });
}

/** Anything that changes the calendar or profile can change the right rail and the coach context. */
function useInvalidateTraining() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['calendar'] });
    void qc.invalidateQueries({ queryKey: keys.timeOff });
    // Planned sessions feed the calorie budget (and the calendar's food layer).
    void qc.invalidateQueries({ queryKey: ['energy', 'budget'] });
    void qc.invalidateQueries({ queryKey: ['energy', 'days'] });
    void qc.invalidateQueries({ queryKey: keys.dashboard });
    void qc.invalidateQueries({ queryKey: keys.profile });
  };
}

export function useCalendarMutations() {
  const invalidate = useInvalidateTraining();
  return {
    create: useMutation({
      mutationFn: async (input: CalendarEventInput) => unwrap(await api.api.calendar.$post({ json: input })),
      onSuccess: invalidate,
    }),
    patch: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: CalendarEventPatch }) =>
        unwrap(await api.api.calendar[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: invalidate,
    }),
    /** An event's goal stays, unlinked, unless `removeGoal` (DECISIONS #100). */
    remove: useMutation({
      mutationFn: async (arg: string | { id: string; removeGoal: boolean }) => {
        const { id, removeGoal } = typeof arg === 'string' ? { id: arg, removeGoal: false } : arg;
        return unwrap(await api.api.calendar[':id'].$delete({ param: { id }, query: removeGoal ? { goal: 'remove' } : {} }));
      },
      onSuccess: invalidate,
    }),
    /** Retry a push to intervals.icu that failed. */
    resync: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.calendar[':id'].sync.$post({ param: { id } })),
      onSuccess: invalidate,
    }),
    /** The matched ride wasn't this session: unpair them for good. */
    unlink: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.calendar[':id'].unlink.$post({ param: { id } })),
      onSuccess: invalidate,
    }),
    /** Group a same-day ride into a session (a long ride split across activities). */
    addRide: useMutation({
      mutationFn: async ({ id, activityId }: { id: string; activityId: string }) =>
        unwrap(await api.api.calendar[':id'].rides.$post({ param: { id }, json: { activityId } })),
      onSuccess: invalidate,
    }),
    /** Take a ride back out of a session; it shows as its own ride again. */
    removeRide: useMutation({
      mutationFn: async ({ id, activityId }: { id: string; activityId: string }) =>
        unwrap(await api.api.calendar[':id'].rides[':activityId'].$delete({ param: { id, activityId } })),
      onSuccess: invalidate,
    }),
  };
}

/** The coach's outlook (DECISIONS #101): null until the coach writes one. */
export function useOutlook() {
  return useQuery({ queryKey: keys.outlook, queryFn: async () => unwrap(await api.api.outlook.$get()) });
}

/** The athlete's own edits (free: no AI), and Undo on a chip from the coach. */
export function useOutlookMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.outlook });
  return {
    save: useMutation({ mutationFn: async (text: string) => unwrap(await api.api.outlook.$put({ json: { text } })), onSuccess: refresh }),
    clear: useMutation({ mutationFn: async () => unwrap(await api.api.outlook.$delete()), onSuccess: refresh }),
    revert: useMutation({ mutationFn: async (input: OutlookRevert) => unwrap(await api.api.outlook.revert.$post({ json: input })), onSuccess: refresh }),
  };
}

/** An event's course (DECISIONS #99): its analysis, never the track. */
export function useCourse(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['calendar', 'course', eventId],
    queryFn: async () => unwrap(await api.api.calendar[':id'].course.$get({ param: { id: eventId } })),
    enabled,
    retry: false,
  });
}

/** The account may use the logged-in Zwift features (DECISIONS #54), Zwift race routes among them (#102). */
export function useZwiftFeature(): boolean {
  return useMe().data?.features.zwiftAccount ?? false;
}

/** Routes a Zwift race can follow (DECISIONS #102). Only fetched for accounts with the Zwift feature. */
export function useZwiftRoutes(enabled: boolean) {
  return useQuery({
    queryKey: ['zwift', 'routes'],
    queryFn: async () => unwrap(await api.api.zwift.routes.$get()),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

/** Add, replace or remove an event's course. The browser reads the GPX; only the resampled track is sent. */
export function useCourseMutations() {
  const invalidate = useInvalidateTraining();
  return {
    put: useMutation({
      mutationFn: async ({ id, input }: { id: string; input: CourseInput }) => unwrap(await api.api.calendar[':id'].course.$put({ param: { id }, json: input })),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.calendar[':id'].course.$delete({ param: { id } })),
      onSuccess: invalidate,
    }),
  };
}

/** A completed session's ride and its reps against the plan (read live from intervals.icu). */
export function useSessionResult(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['calendar', 'result', eventId],
    queryFn: async () => unwrap(await api.api.calendar[':id'].result.$get({ param: { id: eventId } })),
    enabled,
    retry: false,
  });
}

/**
 * Save a ride rating (RPE + note), or a missed session's reason (a note alone; empty clears it, DECISIONS #97).
 * Only the calendar shows them, so only the calendar refetches.
 */
export function useSaveFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SessionFeedbackInput) => unwrap(await api.api.feedback.$put({ json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar'], predicate: (q) => q.queryKey[1] !== 'result' }),
  });
}

export function useProposalMutations(threadId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTraining();
  // Returned, so the card stays busy until its new status is here and its button can't flash back.
  const after = (_: unknown, vars: { id: string }) => {
    invalidate();
    return Promise.all([qc.invalidateQueries({ queryKey: keys.thread(threadId) }), qc.invalidateQueries({ queryKey: ['proposals', vars.id] })]);
  };
  return {
    apply: useMutation({
      mutationFn: async ({ id, indexes }: { id: string; indexes?: number[] }) =>
        unwrap(await api.api.proposals[':id'].apply.$post({ param: { id }, json: indexes ? { indexes } : {} })),
      onSuccess: after,
    }),
    dismiss: useMutation({
      mutationFn: async ({ id, indexes }: { id: string; indexes?: number[] }) =>
        unwrap(await api.api.proposals[':id'].dismiss.$post({ param: { id }, json: indexes ? { indexes } : {} })),
      onSuccess: after,
    }),
  };
}

export function useProfileMutations() {
  const qc = useQueryClient();
  // Returns the profile's refetch, which the mutation waits for: a saved goal shows as saved, not the old one for a moment.
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.dashboard });
    // A weight goal or weight change moves the calorie budget.
    void qc.invalidateQueries({ queryKey: ['energy', 'budget'] });
    return qc.invalidateQueries({ queryKey: keys.profile });
  };
  return {
    saveProfile: useMutation({
      mutationFn: async (profile: Profile) => unwrap(await api.api.profile.$put({ json: profile })),
      onSuccess: invalidate,
    }),
    savePowerBests: useMutation({
      mutationFn: async (bests: PowerBest[]) => unwrap(await api.api['power-bests'].$put({ json: { bests } })),
      onSuccess: invalidate,
    }),
    createGoal: useMutation({
      mutationFn: async (input: GoalInput) => unwrap(await api.api.goals.$post({ json: input })),
      onSuccess: invalidate,
    }),
    updateGoal: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: GoalPatch }) =>
        unwrap(await api.api.goals[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: invalidate,
    }),
    deleteGoal: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.goals[':id'].$delete({ param: { id } })),
      onSuccess: invalidate,
    }),
    createMemory: useMutation({
      mutationFn: async (input: MemoryInput) => unwrap(await api.api.memories.$post({ json: input })),
      onSuccess: invalidate,
    }),
    updateMemory: useMutation({
      mutationFn: async ({ id, ...patch }: MemoryPatch & { id: string }) =>
        unwrap(await api.api.memories[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: invalidate,
    }),
    deleteMemory: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.memories[':id'].$delete({ param: { id } })),
      onSuccess: invalidate,
    }),
    restoreMemory: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.memories[':id'].restore.$post({ param: { id } })),
      onSuccess: invalidate,
    }),
    reviewMemory: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.memories[':id'].review.$post({ param: { id } })),
      onSuccess: invalidate,
    }),
    revertMemory: useMutation({
      mutationFn: async ({ id, ...body }: MemoryRevert & { id: string }) =>
        unwrap(await api.api.memories[':id'].revert.$post({ param: { id }, json: body })),
      onSuccess: invalidate,
    }),
  };
}

export function useIntervalsSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.api.integrations.intervals.sync.$post()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.intervals });
      invalidateSynced(qc);
    },
  });
}

/** Start a full import of all intervals.icu history (DECISIONS #49); it runs in the background. */
export function useIntervalsFullSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.api.integrations.intervals['full-sync'].$post()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.intervals }),
  });
}

/** Pull zFTP, zMAP, weight and FTP from Zwift; a failure comes back as the status's lastError. */
export function useZwiftSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.api.integrations.zwift.sync.$post()),
    onSuccess: (status) => {
      qc.setQueryData(keys.zwift, status);
      void qc.invalidateQueries({ queryKey: keys.dashboard });
      void qc.invalidateQueries({ queryKey: keys.profile });
    },
  });
}

// ── Zwift events (DECISIONS #29) ────────────────────────────────────────────

const EVENTS_PAGE = 100;

/** Pages of the filtered event list; the list fetches the next page as it scrolls. */
export function useEvents(q: Omit<EventQuery, 'offset' | 'limit'>) {
  return useInfiniteQuery({
    queryKey: keys.events(q),
    queryFn: async ({ pageParam }) => unwrap(await api.api.events.query.$post({ json: { ...q, offset: pageParam, limit: EVENTS_PAGE } })),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    // Our own API, never Zwift: events that start while the page is open drop off "Upcoming only".
    refetchInterval: 60_000,
  });
}

/** Feed status. Polls our API (not Zwift) every 2 s only while "Get more events" runs. */
export function useEventsStatus() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.eventsStatus,
    queryFn: async () => {
      const s = await unwrap(await api.api.events.status.$get());
      const prev = qc.getQueryData<typeof s>(keys.eventsStatus);
      // New events landed: a page of the walk, the end of it, or an hourly sync.
      if (prev && (prev.count !== s.count || prev.lastPublicSyncAt !== s.lastPublicSyncAt || prev.extended?.events !== s.extended?.events)) {
        void qc.invalidateQueries({ queryKey: ['events'], predicate: (query) => query.queryKey[1] !== 'status' && query.queryKey[1] !== 'searches' });
      }
      return s;
    },
    refetchInterval: (query) => (query.state.data?.extended?.state === 'running' ? 2000 : 60_000),
  });
}

export function useRefreshEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.api.events.refresh.$post()),
    onSuccess: (status) => {
      qc.setQueryData(keys.eventsStatus, status);
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

/** "Get more events": starts the one logged-in walk; refused (409) inside the 6 h cooldown. */
export function useExtendEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.api.events.extend.$post()),
    onSuccess: (status) => qc.setQueryData(keys.eventsStatus, status),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.eventsStatus }),
  });
}

export function useEventSearches() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: keys.eventSearches, queryFn: async () => unwrap(await api.api.events.searches.$get()) });
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.eventSearches });
  return {
    list,
    create: useMutation({
      mutationFn: async (input: SavedSearchInput) => unwrap(await api.api.events.searches.$post({ json: input })),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.events.searches[':id'].$delete({ param: { id } })),
      onSuccess: invalidate,
    }),
  };
}

/** Add an event to the calendar (through `services/calendar.ts`, like any session). */
export function useAddEventToCalendar() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTraining();
  return useMutation({
    mutationFn: async (input: CalendarEventInput) => unwrap(await api.api.calendar.$post({ json: input })),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

/** Whether the coach can take a message right now, and if not, what to say instead (DECISIONS #76). */
export function useCoachCheck() {
  return useQuery({ queryKey: keys.coachCheck, queryFn: async () => unwrap(await api.api.coach.check.$get()) });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
