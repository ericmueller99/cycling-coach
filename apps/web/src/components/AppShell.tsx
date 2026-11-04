import type { FullSyncProgress } from '@cycling-coach/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { dismissNotice, useAnyRunningTurn, useTurnNotice } from '../lib/coachTurn';
import { useDashboard, useFullSyncRefresh, useMe } from '../lib/queries';
import { fullSyncFraction } from '../routes/athlete/connections';
import { Avatar } from './Avatar';
import { BrandLogo } from './BrandLogo';
import { CORE_NAV, useExtensions, type NavItem } from '../extensions';
import { ChevronRight, LogoIcon, XIcon } from './icons';
import { VerifyEmailBanner } from './VerifyEmailBanner';

/** The same destinations on the sidebar and the phone tab bar: the core five plus any an extension adds. */
function useNav(): readonly NavItem[] {
  const { navItems } = useExtensions();
  return useMemo(() => navItems(CORE_NAV), [navItems]);
}

/** Sidebar footer: who's signed in, linking to /account. */
function ProfileLink({ active }: { active: boolean }) {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <Link
      to="/account"
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-14 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-ink no-underline hover:text-ink ${active ? 'border-line bg-hover' : 'border-transparent hover:bg-surface-2'}`}
    >
      <Avatar name={me.name} />
      <span className="flex min-w-0 grow flex-col">
        <span className="truncate font-semibold">{me.name}</span>
        <span className="truncate text-xs text-muted">{me.email}</span>
      </span>
      <ChevronRight className="shrink-0 text-muted" />
    </Link>
  );
}

/** On the Coach item while a turn is running anywhere (DECISIONS #46). */
function WorkingDot({ className = '', label = 'Coach is working' }: { className?: string; label?: string }) {
  return (
    <span className={`relative flex h-2.5 w-2.5 ${className}`} aria-label={label} role="status">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
    </span>
  );
}

const tabCls = (active: boolean) =>
  `flex flex-col items-center justify-center gap-0.5 border-0 bg-transparent text-[11px] leading-tight no-underline whitespace-nowrap ${active ? 'font-semibold text-ink hover:text-ink' : 'font-medium text-muted hover:text-muted'}`;
const TabPill = ({ active, children }: { active: boolean; children: ReactNode }) => (
  <span className={`flex h-[30px] w-[52px] items-center justify-center rounded-[15px] ${active ? 'bg-[#E4F5B5] text-accent-ink' : ''}`}>{children}</span>
);

/**
 * Mobile bottom tab bar: fixed, 64px + the safe area — the same
 * five as the sidebar. Account is the avatar in each page's top bar.
 */
function BottomTabBar({ nav, path, working, importing }: { nav: readonly NavItem[]; path: string; working: boolean; importing: boolean }) {
  return (
    <nav
      aria-label="Main"
      style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
      className="fixed inset-x-0 bottom-0 z-40 box-content grid h-[64px] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] desktop:hidden"
    >
      {nav.map(({ to, short, icon: Icon, match }) => {
        const active = match(path);
        return (
          <Link key={to} to={to} aria-current={active ? 'page' : undefined} className={tabCls(active)}>
            <TabPill active={active}>
              <span className="relative">
                <Icon size={20} />
                {working && to === '/' && <WorkingDot className="absolute -top-1 -right-1.5" />}
                {importing && to === '/athlete' && <WorkingDot className="absolute -top-1 -right-1.5" label="Importing intervals.icu history" />}
              </span>
            </TabPill>
            {short}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The coach finished while the user was on another page or thread (DECISIONS #46). It never pulls
 * them back by itself; Open does.
 */
function TurnToast() {
  const notice = useTurnNotice();
  if (!notice) return null;
  const text = notice.error ? 'The coach hit a problem' : notice.recipeId ? 'Recipe ready' : 'Coach replied';
  return (
    <div
      role="status"
      className="fixed top-[calc(64px+env(safe-area-inset-top))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[12px] bg-ink py-2 pr-2 pl-4 text-[13px] whitespace-nowrap text-white shadow-lg desktop:top-auto desktop:bottom-8"
    >
      {text}
      <Link
        to="/"
        search={{ t: notice.threadId, ...(notice.recipeId ? { recipe: notice.recipeId } : {}) }}
        onClick={dismissNotice}
        className="font-semibold text-accent no-underline hover:text-accent"
      >
        Open
      </Link>
      <button type="button" aria-label="Dismiss" onClick={dismissNotice} className="flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 text-white/70">
        <XIcon size={14} />
      </button>
    </div>
  );
}

/**
 * While the full intervals.icu import runs (DECISIONS #49): a small progress card in the sidebar
 * (opens Connections, where the detail is), or on phones a thin line along the tab bar's top edge
 * and a dot on the Athlete tab — nothing that floats over a page's own buttons.
 */
function ImportProgress({ progress, variant }: { progress: FullSyncProgress | undefined; variant: 'sidebar' | 'line' }) {
  if (progress?.status !== 'running') return null;
  const pct = Math.round(fullSyncFraction(progress) * 100);
  const label = progress.waitingUntil ? 'History import paused' : 'Importing history';
  if (variant === 'line') {
    // A thin bar along the tab bar's top edge; the Athlete tab carries a dot (see BottomTabBar).
    return (
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 h-[3px] bg-track desktop:hidden"
      >
        <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    );
  }
  return (
    <Link
      to="/athlete/$tab"
      params={{ tab: 'goals' }}
      search={{}}
      className="mb-2 flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3 py-2.5 text-xs text-ink no-underline hover:bg-hover hover:text-ink"
    >
      <span className="flex justify-between gap-2 font-semibold">
        {label}
        <span className="text-muted tabular-nums">{pct}%</span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
        <span className="block h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
    </Link>
  );
}

/**
 * Sidebar + content. ≥ 800px the sidebar stays put beside the content
 * while long pages (the scrolling calendar) scroll. Below that it's replaced by each page's top
 * bar and a fixed bottom tab bar; `main` pads its bottom so nothing hides under the tabs.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data } = useDashboard();
  const working = useAnyRunningTurn();
  const importing = useFullSyncRefresh();
  const nav = useNav();
  const { brand, logo } = useExtensions();
  const ftp = <div className="text-xs text-muted">{data ? (data.snapshot.ftpZwift ? `FTP ${data.snapshot.ftpZwift} W` : 'FTP not set yet') : ' '}</div>;
  return (
    <div className="flex min-h-dvh bg-bg text-ink">
      <nav aria-label="Main" className="sticky top-0 flex h-dvh w-[220px] shrink-0 flex-col gap-1 self-start border-r border-line bg-surface px-3.5 py-5 mobile:hidden">
        {logo ? (
          <div className="flex flex-col gap-1 px-2.5 pt-1.5 pb-5">
            <BrandLogo logo={logo} alt={brand} height={40} />
            {ftp}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-5">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-accent text-on-accent">
              <LogoIcon />
            </div>
            <div>
              <div className="text-base font-bold">{brand}</div>
              {ftp}
            </div>
          </div>
        )}
        {nav.map(({ to, label, icon: Icon, match }) => {
          const active = match(path);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 no-underline ${active ? 'bg-hover font-semibold text-ink' : 'font-medium text-muted hover:bg-surface-2 hover:text-ink'}`}
            >
              <Icon className={active ? 'text-accent-ink' : ''} />
              {label}
              {working && to === '/' && <WorkingDot className="ml-auto" />}
            </Link>
          );
        })}
        <div className="min-h-6 grow" />
        <VerifyEmailBanner variant="card" />
        <ImportProgress progress={importing} variant="sidebar" />
        <ProfileLink active={path.startsWith('/account')} />
      </nav>
      <main className="flex min-w-0 flex-auto flex-col mobile:pb-[calc(64px+env(safe-area-inset-bottom))]">{children}</main>
      <BottomTabBar nav={nav} path={path} working={working} importing={importing?.status === 'running'} />
      <ImportProgress progress={importing} variant="line" />
      <TurnToast />
    </div>
  );
}
