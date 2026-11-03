import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '../lib/useIsMobile';
import { XIcon } from './icons';
import { Sheet } from './Sheet';

/**
 * A modal that is a centred dialog on desktop and the bottom sheet on phones (the food
 * flows — Log food, Add from a photo, Add a staple — are dialogs over the log). Esc and the
 * backdrop close it; the page behind doesn't scroll.
 */
export function Dialog({
  title,
  eyebrow,
  header,
  footer,
  onClose,
  width = 640,
  tall = false,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Extra header content under the title. */
  header?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Desktop max width, px. */
  width?: number;
  /** Fill most of the screen (lists that scroll). */
  tall?: boolean;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Sheet title={title} eyebrow={eyebrow} header={header} footer={footer} onClose={onClose} tall={tall}>
        {children}
      </Sheet>
    );
  }
  return (
    <DesktopDialog title={title} eyebrow={eyebrow} header={header} footer={footer} onClose={onClose} width={width} tall={tall}>
      {children}
    </DesktopDialog>
  );
}

function DesktopDialog({
  title,
  eyebrow,
  header,
  footer,
  onClose,
  width,
  tall,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width: number;
  tall: boolean;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div aria-hidden="true" className="absolute inset-0 bg-[rgba(21,24,30,.45)]" onClick={onClose} />
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex w-full flex-col overflow-hidden rounded-[16px] bg-surface shadow-[0_20px_60px_rgba(0,0,0,.18)] outline-none ${tall ? 'h-[min(760px,92dvh)]' : 'max-h-[92dvh]'}`}
        style={{ maxWidth: width }}
      >
        <header className="flex flex-none items-start gap-3 border-b border-line py-4 pr-3 pl-6">
          <div className="min-w-0 flex-auto">
            {eyebrow && <div className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{eyebrow}</div>}
            <h2 id={titleId} className="m-0 text-lg">
              {title}
            </h2>
            {header}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-ink hover:bg-surface-2">
            <XIcon size={20} />
          </button>
        </header>
        <div className="flex min-h-0 flex-auto flex-col gap-3.5 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex-none border-t border-line bg-surface-alt px-6 py-3">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
