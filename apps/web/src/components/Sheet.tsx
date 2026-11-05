import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from './icons';

/**
 * Mobile bottom sheet: dimmed backdrop that closes on tap, 20px top
 * radius, grabber, close ×, a scrolling body and an optional sticky footer. Esc closes; the page
 * behind doesn't scroll while it's open. `tall` fills most of the screen (session details);
 * otherwise it sizes to its content. On desktop (the day view) it's a drawer on the right. `panel`
 * is a working space rather than a detail: the whole screen on a phone, a little wider on desktop.
 */
export function Sheet({
  title,
  eyebrow,
  header,
  footer,
  action,
  onClose,
  tall = false,
  panel = false,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Extra header content under the title (tags). */
  header?: ReactNode;
  footer?: ReactNode;
  /** A text action beside the close button ("Reset" in the event filters). */
  action?: ReactNode;
  onClose: () => void;
  tall?: boolean;
  panel?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" className="absolute inset-0 bg-[rgba(21,24,30,.45)]" onClick={onClose} />
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute inset-x-0 bottom-0 flex flex-col bg-surface shadow-[0_-8px_30px_rgba(0,0,0,.12)] outline-none ${panel ? 'h-dvh pt-[env(safe-area-inset-top)]' : `rounded-t-[20px] ${tall ? 'h-[90dvh]' : 'max-h-[90dvh]'}`} desktop:top-0 desktop:left-auto desktop:h-full desktop:max-h-none ${panel ? 'desktop:w-[460px]' : 'desktop:w-[440px]'} desktop:rounded-none desktop:shadow-[-8px_0_30px_rgba(0,0,0,.12)]`}
      >
        {!panel && (
          <div className="flex flex-none justify-center pt-2 desktop:hidden">
            <span aria-hidden="true" className="h-[5px] w-[40px] rounded-[3px] bg-line-strong" />
          </div>
        )}
        <div className="flex flex-none items-start gap-2 pt-2 pr-2 pl-5 desktop:pt-4">
          <div className="min-w-0 flex-auto">
            {eyebrow && <div className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{eyebrow}</div>}
            <h2 id={titleId} className="mt-0.5 mb-0 text-[22px]">
              {title}
            </h2>
            {header}
          </div>
          {action && <div className="flex h-[44px] flex-none items-center">{action}</div>}
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-[44px] w-[44px] flex-none items-center justify-center border-0 bg-transparent text-ink">
            <XIcon size={20} />
          </button>
        </div>
        <div className={`flex min-h-0 flex-auto flex-col gap-3.5 overflow-y-auto px-5 pt-4 ${footer ? 'pb-4' : 'pb-[calc(20px+env(safe-area-inset-bottom))]'}`}>
          {children}
        </div>
        {footer && <div className="flex-none border-t border-line px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}
