import { weekStart } from '@cycling-coach/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
  stripSearchParams,
  useRouteContext,
  useRouterState,
  type AnyRoute,
  type AnyRouter,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { ExtensionsProvider, type Extensions } from './extensions';
import { DEFAULT_EVENTS_SEARCH, parseEventsSearch } from './lib/events';
import { useMe } from './lib/queries';
import { AccountPage } from './routes/AccountPage';
import { ATHLETE_TABS, AthletePage, type AthleteTab } from './routes/athlete/AthletePage';
import { CalendarPage } from './routes/CalendarPage';
import { DayRoute } from './routes/calendar/DayRoute';
import { CoachPage } from './routes/coach/CoachPage';
import { EventsPage } from './routes/events/EventsPage';
import { LIBRARY_TABS, LibraryPage, type LibraryTab } from './routes/library/LibraryPage';
import { RecipePage } from './routes/library/RecipePage';
import { LoginPage } from './routes/LoginPage';
import { SharedRecipePage } from './routes/SharedRecipePage';

/**
 * The app as a library (DECISIONS #58). The self-hosted entry (`main.tsx`) calls these with no
 * options; an app built on this one adds its own routes, public pages and slots (`extensions.tsx`)
 * and must register its own router type. It must also give Vite `resolve.dedupe` for React and
 * TanStack (the coach-turn store and the query cache are module singletons) and point Tailwind at
 * this package with `@source`.
 */

export { defaultExtensions, ExtensionsProvider, useExtensions, CORE_NAV, type ConnectSlot, type Extensions, type NavItem } from './extensions';
export { reloadOnStaleChunks } from './lib/appVersion';

export interface RouterContext {
  /** Path prefixes shown without sign-in or the app shell. */
  publicPaths: readonly string[];
}

/** Share links (`/r/:token`, DECISIONS #48) are always public. */
const CORE_PUBLIC_PATHS = ['/r/'] as const;

/** Public pages render bare; everything else is behind the one login, inside the app shell. */
function Root() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { publicPaths } = useRouteContext({ from: '__root__' });
  return publicPaths.some((p) => pathname.startsWith(p)) ? <Outlet /> : <SignedIn />;
}

function SignedIn() {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (!me.data) return <LoginPage />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Root });

/** The root every route hangs off; extra routes use `getParentRoute: () => appRootRoute`. */
export const appRootRoute = rootRoute;
export type AppRootRoute = typeof rootRoute;

/**
 * `recipe` opens a coach recipe in the right-hand pane; `idea` ("{ideasId}.{index}")
 * opens a meal idea's Details pane. One pane at a time.
 */
type CoachSearch = { t?: string; new?: boolean; prompt?: string; recipe?: string; idea?: string };

/**
 * One route for every conversation, with the thread in the search string: switching from "no
 * thread" to the newly created one mid-stream must not remount the page and drop the stream.
 */
const coachRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (s: Record<string, unknown>): CoachSearch => ({
    ...(typeof s['t'] === 'string' ? { t: s['t'] } : {}),
    ...(s['new'] === true || s['new'] === 'true' ? { new: true } : {}),
    ...(typeof s['prompt'] === 'string' ? { prompt: s['prompt'] } : {}),
    ...(typeof s['recipe'] === 'string' && /^[a-f0-9]{24}$/.test(s['recipe']) ? { recipe: s['recipe'] } : {}),
    ...(typeof s['idea'] === 'string' && /^[a-f0-9]{24}\.[0-3]$/.test(s['idea']) && typeof s['recipe'] !== 'string' ? { idea: s['idea'] } : {}),
  }),
  component: function CoachRoute() {
    const { t, new: isNew, prompt, recipe, idea } = coachRoute.useSearch();
    return <CoachPage threadId={t} isNew={isNew} prompt={prompt} recipe={recipe} idea={idea} />;
  },
});

type CalendarSearch = { week?: string };

/** `?week=` is the week on show, always a Monday; anything else is dropped. */
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  validateSearch: (s: Record<string, unknown>): CalendarSearch => {
    const week = s['week'];
    return typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week) && !Number.isNaN(Date.parse(week)) ? { week: weekStart(week) } : {};
  },
  component: function CalendarRoute() {
    const { week } = calendarRoute.useSearch();
    return <CalendarPage week={week} />;
  },
});
/** Zwift events: the filters are the search string; defaults are left out of it. */
const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events',
  validateSearch: parseEventsSearch,
  search: { middlewares: [stripSearchParams(DEFAULT_EVENTS_SEARCH)] },
  component: function EventsRoute() {
    return <EventsPage search={eventsRoute.useSearch()} />;
  },
});
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** One day of training + food: the full day view on desktop, the day timeline on phones. */
const calendarDayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar/$date',
  beforeLoad: ({ params }) => {
    if (!isIsoDate(params.date)) throw redirect({ to: '/calendar', replace: true });
  },
  component: function CalendarDay() {
    const { date } = calendarDayRoute.useParams();
    return <DayRoute date={date} />;
  },
});

/** Library: Workouts · Foods · Recipes · Meals. */
const libraryIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  beforeLoad: () => {
    throw redirect({ to: '/library/$tab', params: { tab: 'workouts' }, replace: true });
  },
});
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/$tab',
  beforeLoad: ({ params }) => {
    if (!LIBRARY_TABS.includes(params.tab as LibraryTab)) throw redirect({ to: '/library/$tab', params: { tab: 'workouts' }, replace: true });
  },
  component: function LibraryRoute() {
    const { tab } = libraryRoute.useParams();
    return <LibraryPage tab={tab as LibraryTab} />;
  },
});

/** `?for=N` — "Cooking for N" on a recipe page or share link (display only, DECISIONS #47). */
const cookForSearch = (s: Record<string, unknown>): { for?: number } => {
  const n = Number(s['for']);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? { for: n } : {};
};

/** A Library recipe's page. */
const recipePageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/recipes/$id',
  validateSearch: cookForSearch,
  beforeLoad: ({ params }) => {
    if (!/^[a-f0-9]{24}$/.test(params.id)) throw redirect({ to: '/library/$tab', params: { tab: 'recipes' }, replace: true });
  },
  component: function RecipePageRoute() {
    const { id } = recipePageRoute.useParams();
    return <RecipePage id={id} cookFor={recipePageRoute.useSearch().for} />;
  },
});

/** A shared recipe — public, no sign-in (DECISIONS #48). */
const sharedRecipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/r/$token',
  validateSearch: cookForSearch,
  component: function SharedRecipeRoute() {
    const { token } = sharedRecipeRoute.useParams();
    return <SharedRecipePage token={token} cookFor={sharedRecipeRoute.useSearch().for} />;
  },
});

/** Athlete: Performance · Body & energy · Goals & coach. `?addWeightGoal=1` opens the goal editor. */
const athleteIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/athlete',
  beforeLoad: () => {
    throw redirect({ to: '/athlete/$tab', params: { tab: 'performance' }, replace: true });
  },
});
const athleteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/athlete/$tab',
  validateSearch: (s: Record<string, unknown>): { addWeightGoal?: boolean } =>
    s['addWeightGoal'] === true || s['addWeightGoal'] === 1 || s['addWeightGoal'] === '1' || s['addWeightGoal'] === 'true' ? { addWeightGoal: true } : {},
  beforeLoad: ({ params }) => {
    if (!ATHLETE_TABS.includes(params.tab as AthleteTab)) throw redirect({ to: '/athlete/$tab', params: { tab: 'performance' }, replace: true });
  },
  component: function AthleteRoute() {
    const { tab } = athleteRoute.useParams();
    const { addWeightGoal } = athleteRoute.useSearch();
    return <AthletePage tab={tab as AthleteTab} addWeightGoal={addWeightGoal ?? false} />;
  },
});

/** Old addresses keep working. */
const foodRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: '/food',
  validateSearch: (s: Record<string, unknown>): { date?: string } => (isIsoDate(s['date']) ? { date: s['date'] } : {}),
  beforeLoad: ({ search }) => {
    if (search.date) throw redirect({ to: '/calendar/$date', params: { date: search.date }, replace: true });
    throw redirect({ to: '/calendar', replace: true });
  },
});
const libraryRedirect = <const P extends string>(from: P, tab: LibraryTab) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: from,
    beforeLoad: () => {
      throw redirect({ to: '/library/$tab', params: { tab }, replace: true });
    },
  });
const profileRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  beforeLoad: () => {
    throw redirect({ to: '/athlete/$tab', params: { tab: 'performance' }, replace: true });
  },
});

/** `?password=1` is the full-screen change-password view on mobile. */
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  validateSearch: (s: Record<string, unknown>): { password?: boolean } =>
    s['password'] === true || s['password'] === 'true' || s['password'] === 1 || s['password'] === '1' ? { password: true } : {},
  component: function AccountRoute() {
    const { password } = accountRoute.useSearch();
    return <AccountPage password={password} />;
  },
});

const coreRoutes = [
  coachRoute,
  calendarRoute,
  calendarDayRoute,
  eventsRoute,
  libraryIndexRoute,
  libraryRoute,
  recipePageRoute,
  sharedRecipeRoute,
  athleteIndexRoute,
  athleteRoute,
  accountRoute,
  foodRedirect,
  libraryRedirect('/food/foods', 'foods'),
  libraryRedirect('/food/recipes', 'recipes'),
  libraryRedirect('/food/meals', 'meals'),
  libraryRedirect('/workouts', 'workouts'),
  profileRedirect,
] as const;

export interface AppRouterOptions<TExtra extends readonly AnyRoute[]> {
  /**
   * Routes beside the core ones, children of `appRootRoute`. They render inside the app shell behind
   * the login unless their path starts with one of `publicPaths`. Define each as its own `const`
   * (as below) and pass the constants: routes written inline here lose their types, and with them
   * every typed `Link` in the app.
   */
  extraRoutes?: TExtra;
  /** More path prefixes that render without sign-in or the app shell (a register page). */
  publicPaths?: readonly string[];
}

export function createAppRouter<const TExtra extends readonly AnyRoute[] = []>(opts: AppRouterOptions<TExtra> = {}) {
  const extra = (opts.extraRoutes ?? []) as TExtra;
  return createRouter({
    routeTree: rootRoute.addChildren([...coreRoutes, ...extra]),
    context: { publicPaths: [...CORE_PUBLIC_PATHS, ...(opts.publicPaths ?? [])] },
    defaultPreload: 'intent',
    // The calendar scrolls itself to today and the coach to the latest message on mount;
    // the router's scroll-to-top after render would undo both.
    scrollRestoration: ({ location }) => location.pathname !== '/' && !location.pathname.startsWith('/calendar'),
  });
}

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });
}

/** The whole app. `router` comes from `createAppRouter`; `extensions` fill the slots (defaults: self-hosted). */
export function App({
  router,
  queryClient,
  extensions,
}: {
  router: AnyRouter;
  queryClient: QueryClient;
  extensions?: Partial<Extensions>;
}) {
  return (
    <StrictMode>
      <ExtensionsProvider value={extensions}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ExtensionsProvider>
    </StrictMode>
  );
}
