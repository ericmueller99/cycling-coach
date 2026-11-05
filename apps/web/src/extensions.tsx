import type { LinkOptions } from '@tanstack/react-router';
import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import { ClaudeUsageRow } from './components/ClaudeUsageRow';
import { CalendarIcon, ChatIcon, FlagIcon, LibraryIcon, TargetIcon } from './components/icons';

/**
 * The places where an app built on this one (DECISIONS #58) puts its own pieces: extra navigation,
 * its name and logo, what sits under the sign-in form, how an athlete connects intervals.icu or Zwift, the
 * usage row and extra Account cards. Every slot has a default, which is the self-hosted app.
 */

/** A sidebar and tab bar destination. */
export interface NavItem {
  to: NonNullable<LinkOptions['to']>;
  label: string;
  /** The tab bar label, where space is short. */
  short: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Whether the item is the current page. */
  match: (pathname: string) => boolean;
}

/**
 * A Connections row's deployment-specific parts. `hint` is the text under the name while the athlete
 * isn't connected; `action` (a Connect button) shows while they aren't connected or the connection
 * broke; `manage` (change login, disconnect) shows while a connection exists, working or broken.
 */
export interface ConnectSlot {
  hint: ReactNode;
  action?: ReactNode;
  manage?: ReactNode;
}

export interface Extensions {
  /** The product name: sidebar, sign-in page, share links. */
  brand: string;
  /**
   * Logo images for light and dark backgrounds, shown instead of the tile and name (DECISIONS #70).
   * Self-host: none.
   */
  logo: { light: string; dark: string } | null;
  /** A square logo image, shown instead of the lime tile wherever the tile appears (DECISIONS #74). Self-host: none. */
  logoMark: string | null;
  /** Sidebar and tab bar items, given the core five. */
  navItems: (core: readonly NavItem[]) => readonly NavItem[];
  /** Under the sign-in form, for anything extra (sign-up and reset links come from the server's auth config). */
  loginFooter: ReactNode;
  /**
   * Terms and privacy pages. When set, the auth pages link them and registering requires agreeing
   * to them (DECISIONS #61). Self-host: none.
   */
  legalLinks: { terms: string; privacy: string } | null;
  /** What `/register` says while this server doesn't take sign-ups. */
  signUpClosed: ReactNode;
  /** The intervals.icu row on Connections while this athlete isn't connected. */
  intervalsConnect: ConnectSlot;
  /** The Zwift row on Connections while this athlete has no Zwift login. */
  zwiftConnect: ConnectSlot;
  /** More rows on Connections, above the usage row, for sources only this deployment has (DECISIONS #73). */
  extraConnections: ReactNode;
  /** Extra cards on Athlete › Body & energy, above the budget (DECISIONS #73). */
  athleteBodyCards: ReactNode;
  /** The usage row on Connections (the self-hosted app shows Claude API spend); `null` hides it. */
  usageCard: ComponentType | null;
  /** Extra cards at the end of the Account page. */
  accountCards: ReactNode;
  /** Under the Coach composer, for anything the athlete should know before sending (plan limits). */
  coachNotice: ComponentType | null;
  /** Coach words that depend on who pays for the AI (DECISIONS #85). */
  coachCopy: { thinkDeeperHint: string; memoryNote: string };
  /**
   * The end of the Coach snapshot card, given the weight tile to place. A deployment with more
   * health numbers shows them around it (DECISIONS #85).
   */
  snapshotHealth: ComponentType<{ weightTile: ReactNode }>;
}

/** The core destinations. */
export const CORE_NAV: readonly NavItem[] = [
  { to: '/', label: 'Coach', short: 'Coach', icon: ChatIcon, match: (p) => p === '/' || p.startsWith('/c/') },
  { to: '/calendar', label: 'Calendar', short: 'Calendar', icon: CalendarIcon, match: (p) => p.startsWith('/calendar') },
  { to: '/events', label: 'Zwift Events', short: 'Zwift Events', icon: FlagIcon, match: (p) => p.startsWith('/events') },
  { to: '/library', label: 'Library', short: 'Library', icon: LibraryIcon, match: (p) => p.startsWith('/library') },
  { to: '/athlete', label: 'Athlete', short: 'Athlete', icon: TargetIcon, match: (p) => p.startsWith('/athlete') },
];

/** The self-hosted app: credentials come from the server's env and apply to the owner account only (DECISIONS #53). */
export const defaultExtensions: Extensions = {
  brand: 'Coach',
  logo: null,
  logoMark: null,
  navItems: (core) => core,
  loginFooter: null,
  legalLinks: null,
  signUpClosed: 'Sign-up is closed on this server. Ask whoever runs it for an account.',
  intervalsConnect: { hint: 'Set INTERVALS_ICU_KEY on the server — it connects the owner account only' },
  zwiftConnect: { hint: 'Set ZWIFT_USERNAME and ZWIFT_PASSWORD on the server (owner account only), or enter zFTP by hand' },
  extraConnections: null,
  athleteBodyCards: null,
  usageCard: ClaudeUsageRow,
  accountCards: null,
  coachNotice: null,
  coachCopy: {
    thinkDeeperHint: 'Slower, uses more AI',
    memoryNote: 'Changes you make here don’t use any AI. Asking the coach to remember or forget something in chat does.',
  },
  snapshotHealth: ({ weightTile }) => <div className="grid grid-cols-3 gap-2">{weightTile}</div>,
};

const ExtensionsContext = createContext<Extensions>(defaultExtensions);

export function ExtensionsProvider({ value, children }: { value: Partial<Extensions> | undefined; children: ReactNode }) {
  const merged = useMemo(() => ({ ...defaultExtensions, ...value }), [value]);
  return <ExtensionsContext.Provider value={merged}>{children}</ExtensionsContext.Provider>;
}

export const useExtensions = (): Extensions => useContext(ExtensionsContext);
