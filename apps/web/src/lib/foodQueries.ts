import type {
  BodyScanInput,
  BodyScanPatch,
  EnergyPatch,
  FoodAdjustInput,
  FoodInput,
  FoodLogInput,
  FoodLogPatch,
  FoodPatch,
  FoodSettings,
  IsoDate,
  MealIdeaFix,
  MealIdeas,
  MealInput,
  MealPatch,
  PhotoReadInput,
  RecipeDraft,
  RecipeDraftLogInput,
  RecipeDraftPatch,
  RecipeInput,
  RecipePatch,
  StapleSource,
} from '@cycling-coach/shared';
import { addDays } from '@cycling-coach/core';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './api';
import { CALENDAR_CHUNK_WEEKS } from './queries';

/** Food module queries. Everything food lives under the `food` key prefix. */
export const foodKeys = {
  all: ['food'] as const,
  library: ['food', 'library'] as const,
  log: (from: IsoDate, to: IsoDate) => ['food', 'log', from, to] as const,
  energy: ['energy'] as const,
  budget: (date: IsoDate) => ['energy', 'budget', date] as const,
  /** The calendar's food layer; under `energy` so budget changes refresh it too. */
  days: (from: IsoDate, to: IsoDate) => ['energy', 'days', from, to] as const,
  staples: (source: StapleSource, q: string) => ['staples', source, q] as const,
  staple: (source: StapleSource, ref: string) => ['staples', source, 'detail', ref] as const,
};

/** Staples search (CNF first, USDA fallback). Reference data — cached for the session. */
export function useStapleSearch(q: string, source: StapleSource, enabled = true) {
  return useQuery({
    queryKey: foodKeys.staples(source, q),
    queryFn: async () => unwrap(await api.api.food.staples.$get({ query: { q, source } })),
    enabled: enabled && q.trim().length >= 2,
    staleTime: Infinity,
  });
}

export function useStapleDetail(source: StapleSource, ref: string | undefined) {
  return useQuery({
    queryKey: foodKeys.staple(source, ref ?? ''),
    queryFn: async () => unwrap(await api.api.food.staples[':source'][':ref'].$get({ param: { source, ref: ref! } })),
    enabled: !!ref,
    staleTime: Infinity,
  });
}

/** The user's whole foods library — foods, recipes, meals, usage — one cached payload; search is local. */
export function useFoodLibrary() {
  return useQuery({ queryKey: foodKeys.library, queryFn: async () => unwrap(await api.api.food.library.$get()), staleTime: 5 * 60_000 });
}

export function useFoodLog(from: IsoDate, to: IsoDate = from) {
  return useQuery({
    queryKey: foodKeys.log(from, to),
    queryFn: async () => unwrap(await api.api.food.log.$get({ query: { from, to } })),
  });
}

/** Writes to the foods database and the log. Logging also refreshes the library (usual portions). */
export function useFoodMutations() {
  const qc = useQueryClient();
  const library = () => void qc.invalidateQueries({ queryKey: foodKeys.library });
  /** A log write changes the day's totals and the calendar's food layer. */
  const everything = () => {
    void qc.invalidateQueries({ queryKey: foodKeys.all });
    void qc.invalidateQueries({ queryKey: ['energy', 'days'] });
  };
  return {
    createFood: useMutation({
      mutationFn: async (input: FoodInput) => unwrap(await api.api.food.foods.$post({ json: input })),
      onSuccess: library,
    }),
    updateFood: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: FoodPatch }) =>
        unwrap(await api.api.food.foods[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: library,
    }),
    archiveFood: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.food.foods[':id'].$delete({ param: { id } })),
      onSuccess: library,
    }),
    createRecipe: useMutation({
      mutationFn: async (input: RecipeInput) => unwrap(await api.api.food.recipes.$post({ json: input })),
      onSuccess: library,
    }),
    updateRecipe: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: RecipePatch }) =>
        unwrap(await api.api.food.recipes[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: library,
    }),
    archiveRecipe: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.food.recipes[':id'].$delete({ param: { id } })),
      onSuccess: library,
    }),
    createMeal: useMutation({
      mutationFn: async (input: MealInput) => unwrap(await api.api.food.meals.$post({ json: input })),
      onSuccess: library,
    }),
    updateMeal: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: MealPatch }) =>
        unwrap(await api.api.food.meals[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: library,
    }),
    archiveMeal: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.food.meals[':id'].$delete({ param: { id } })),
      onSuccess: library,
    }),
    log: useMutation({
      mutationFn: async (entries: FoodLogInput[]) => unwrap(await api.api.food.log.$post({ json: { entries } })),
      onSuccess: everything,
    }),
    patchEntry: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: FoodLogPatch }) =>
        unwrap(await api.api.food.log[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: everything,
    }),
    deleteEntry: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.food.log[':id'].$delete({ param: { id } })),
      onSuccess: everything,
    }),
    copyEntry: useMutation({
      mutationFn: async ({ id, date, slot }: { id: string; date: IsoDate; slot?: string }) =>
        unwrap(await api.api.food.log[':id'].copy.$post({ param: { id }, json: slot ? { date, slot } : { date } })),
      onSuccess: everything,
    }),
    saveSettings: useMutation({
      mutationFn: async (settings: FoodSettings) => unwrap(await api.api.food.settings.$put({ json: settings })),
      onSuccess: library,
    }),
  };
}

/** Read a label / screenshot with the small model (nothing is saved — the result is reviewed). */
export function useReadPhoto() {
  return useMutation({ mutationFn: async (input: PhotoReadInput) => unwrap(await api.api.food.photo.$post({ json: input })) });
}

/** Ask how much a food's values move (nothing is saved — the form applies the answer, or doesn't). */
export function useAdjustFood() {
  return useMutation({ mutationFn: async (input: FoodAdjustInput) => unwrap(await api.api.food.adjust.$post({ json: input })) });
}

/** One of the user's foods for a barcode, else an Open Food Facts product to review. */
export async function lookupBarcode(code: string) {
  return unwrap(await api.api.food.barcode[':code'].$get({ param: { code } }));
}

/** Signed links to a food's stored photos (short-lived). */
export function useFoodImages(foodId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['food', 'images', foodId],
    queryFn: async () => unwrap(await api.api.food.foods[':id'].images.$get({ param: { id: foodId } })),
    enabled,
    staleTime: 10 * 60_000,
  });
}

// ── BMR & body scans (Athlete page) ───────────────────────────────────────

export function useEnergy() {
  return useQuery({ queryKey: foodKeys.energy, queryFn: async () => unwrap(await api.api.energy.$get()) });
}

/** The day's calorie budget (BMR + daily activity + exercise + goal). Rides arrive with the sync. */
export function useEnergyBudget(date: IsoDate) {
  return useQuery({
    queryKey: foodKeys.budget(date),
    queryFn: async () => unwrap(await api.api.energy.budget.$get({ query: { date } })),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useEnergyMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: foodKeys.energy });
  return {
    patch: useMutation({
      mutationFn: async (patch: EnergyPatch) => unwrap(await api.api.energy.$patch({ json: patch })),
      onSuccess: (data) => {
        qc.setQueryData(foodKeys.energy, data);
        void qc.invalidateQueries({ queryKey: ['energy', 'budget'] });
        void qc.invalidateQueries({ queryKey: ['energy', 'days'] });
      },
    }),
    addScan: useMutation({
      mutationFn: async (input: BodyScanInput) => unwrap(await api.api.energy.scans.$post({ json: input })),
      onSuccess: invalidate,
    }),
    updateScan: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: BodyScanPatch }) =>
        unwrap(await api.api.energy.scans[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: invalidate,
    }),
    deleteScan: useMutation({
      mutationFn: async (id: string) => unwrap(await api.api.energy.scans[':id'].$delete({ param: { id } })),
      onSuccess: invalidate,
    }),
  };
}

/**
 * The calendar's food layer on the same 4-week chunk grid as `useCalendarRange`:
 * eaten vs budget per day and trend weight per week, one request per chunk.
 */
export function useDaysRange(start: IsoDate, weeks: number, enabled = true) {
  const chunks = Array.from({ length: Math.ceil(weeks / CALENDAR_CHUNK_WEEKS) }, (_, i) => {
    const from = addDays(start, i * CALENDAR_CHUNK_WEEKS * 7);
    return { from, to: addDays(from, CALENDAR_CHUNK_WEEKS * 7 - 1) };
  });
  return useQueries({
    queries: chunks.map(({ from, to }) => ({
      queryKey: foodKeys.days(from, to),
      queryFn: async () => unwrap(await api.api.energy.days.$get({ query: { from, to } })),
      enabled,
      staleTime: 60_000,
    })),
    combine: (results) => ({
      days: new Map(results.flatMap((r) => r.data?.days ?? []).map((d) => [d.date, d] as const)),
      weeks: new Map(results.flatMap((r) => r.data?.weeks ?? []).map((w) => [w.start, w.trendKg] as const)),
      warning: results.find((r) => r.data?.warning)?.data?.warning,
      pending: results.some((r) => r.isPending && r.fetchStatus !== 'idle'),
    }),
  });
}

// ── Meal ideas & recipes from Coach chat ─────────────────

export const coachFoodKeys = {
  ideas: (id: string) => ['coach-food', 'ideas', id] as const,
  recipe: (id: string) => ['coach-food', 'recipe', id] as const,
};

export function useMealIdeas(id: string, initialData?: MealIdeas) {
  return useQuery({
    queryKey: coachFoodKeys.ideas(id),
    queryFn: async () => unwrap(await api.api['coach-food'].ideas[':id'].$get({ param: { id } })),
    ...(initialData ? { initialData } : {}),
  });
}

export function useRecipeDraft(id: string | undefined, initialData?: RecipeDraft) {
  return useQuery({
    queryKey: coachFoodKeys.recipe(id ?? 'none'),
    queryFn: async () => unwrap(await api.api['coach-food'].recipes[':id'].$get({ param: { id: id! } })),
    enabled: !!id,
    ...(initialData ? { initialData } : {}),
  });
}

/**
 * Pick a match for an unmatched ingredient in the Details pane. The cards and the pane read
 * the same query, so both update; a staple pick added one of their foods.
 */
export function useMealIdeaFix(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fix: MealIdeaFix) => unwrap(await api.api['coach-food'].ideas[':id'].$patch({ param: { id }, json: fix })),
    onSuccess: (ideas) => {
      qc.setQueryData(coachFoodKeys.ideas(id), ideas);
      void qc.invalidateQueries({ queryKey: foodKeys.all });
      void qc.invalidateQueries({ queryKey: ['threads', ideas.threadId] });
    },
  });
}

/** Fix a line, save as a recipe, or log servings — each returns the updated draft. */
export function useRecipeDraftMutations(id: string) {
  const qc = useQueryClient();
  const settle = (draft: RecipeDraft, wrote: boolean) => {
    qc.setQueryData(coachFoodKeys.recipe(id), draft);
    if (!wrote) return;
    // Saving adds a recipe (and maybe staple foods); logging changes the day and the calendar's food layer.
    void qc.invalidateQueries({ queryKey: foodKeys.all });
    void qc.invalidateQueries({ queryKey: ['energy', 'days'] });
    void qc.invalidateQueries({ queryKey: ['threads', draft.threadId] });
  };
  return {
    patch: useMutation({
      mutationFn: async (patch: RecipeDraftPatch) => unwrap(await api.api['coach-food'].recipes[':id'].$patch({ param: { id }, json: patch })),
      onSuccess: (d) => settle(d, false),
    }),
    save: useMutation({
      mutationFn: async () => unwrap(await api.api['coach-food'].recipes[':id'].save.$post({ param: { id } })),
      onSuccess: (d) => settle(d, true),
    }),
    log: useMutation({
      mutationFn: async (input: RecipeDraftLogInput) => unwrap(await api.api['coach-food'].recipes[':id'].log.$post({ param: { id }, json: input })),
      onSuccess: (d) => settle(d, true),
    }),
  };
}

// ── Recipe pages and share links (DECISIONS #47–48) ─────────────────────────

export const recipeKeys = {
  /** Under `food`, so any library change refreshes it. */
  detail: (id: string) => ['food', 'recipe', id] as const,
  shared: (token: string) => ['shared-recipe', token] as const,
};

/** A Library recipe as its page shows it: the recipe, how it reads, and its share link. */
export function useRecipeDetail(id: string) {
  return useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: async () => unwrap(await api.api.food.recipes[':id'].$get({ param: { id } })),
  });
}

export function useRecipeShareMutations(id: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: recipeKeys.detail(id) });
  return {
    share: useMutation({
      mutationFn: async () => unwrap(await api.api.food.recipes[':id'].share.$post({ param: { id } })),
      onSuccess: refresh,
    }),
    unshare: useMutation({
      mutationFn: async () => unwrap(await api.api.food.recipes[':id'].share.$delete({ param: { id } })),
      onSuccess: refresh,
    }),
  };
}

/** `/r/:token` — no sign-in. A 404/410 is an answer, not something to retry. */
export function useSharedRecipe(token: string) {
  return useQuery({
    queryKey: recipeKeys.shared(token),
    queryFn: async () => unwrap(await api.api.public.recipes[':token'].$get({ param: { token } })),
    retry: false,
  });
}
