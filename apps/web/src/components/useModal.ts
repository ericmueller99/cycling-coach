import { useEffect, useRef, type RefObject } from 'react';

/** Open modals, oldest first. Esc closes only the top one, so a dialog stacked over an editor doesn't take the editor with it. */
const open: object[] = [];

/** While mounted: takes focus and gives it back, closes on Esc, and stops the page behind scrolling. */
export function useModal(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const token = {};
    open.push(token);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && open.at(-1) === token && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      open.splice(open.indexOf(token), 1);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [ref]);
}
