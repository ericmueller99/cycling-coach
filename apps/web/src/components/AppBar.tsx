import { Link, useRouter } from '@tanstack/react-router';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { useMe } from '../lib/queries';
import { Avatar } from './Avatar';
import { ChevronLeft } from './icons';

/** 44×44 transparent icon button for the mobile top bar. */
export function IconButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }) {
  return (
    <button
      type="button"
      className={`flex h-[44px] w-[44px] shrink-0 items-center justify-center border-0 bg-transparent p-0 text-ink ${className}`}
      {...props}
    />
  );
}

/** Back to wherever the user came from; straight to Coach when the page was opened directly. */
function BackButton() {
  const router = useRouter();
  return (
    <IconButton
      aria-label="Back"
      onClick={() => (window.history.length > 1 ? router.history.back() : void router.navigate({ to: '/' }))}
    >
      <ChevronLeft size={20} strokeWidth={2.2} />
    </IconButton>
  );
}

/**
 * The mobile top app bar: 56px, sticky. Title on the left, page actions and the
 * avatar (→ /account) on the right; `back` swaps the avatar for a back arrow on the left.
 * `children` render inside the sticky block, under the bar (chip rows, the calendar's week header).
 */
export function AppBar({
  title,
  subtitle,
  leading,
  actions,
  back = false,
  border = true,
  children,
  ref,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  back?: boolean;
  border?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}) {
  const { data: me } = useMe();
  const inset = back || leading;
  return (
    // Top safe area: 0 in Safari and under the home-screen app's solid status bar, but right if
    // the status bar ever becomes translucent (or inside Capacitor).
    <header ref={ref} className={`sticky top-0 z-20 bg-surface pt-[env(safe-area-inset-top)] ${border ? 'border-b border-line' : ''}`}>
      <div className={`flex h-[56px] items-center gap-0.5 pr-1.5 ${inset ? 'pl-1' : 'pl-4'}`}>
        {back && <BackButton />}
        {leading}
        <div className="min-w-0 flex-auto">
          <h1 className={`m-0 truncate font-bold ${subtitle ? 'text-[16px]' : back ? 'text-[18px]' : 'text-[20px]'}`}>{title}</h1>
          {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
        </div>
        {actions}
        {!back && me && (
          <Link to="/account" aria-label="Account" className="flex h-[44px] w-[44px] shrink-0 items-center justify-center no-underline">
            <Avatar name={me.name} size={32} />
          </Link>
        )}
      </div>
      {children}
    </header>
  );
}
