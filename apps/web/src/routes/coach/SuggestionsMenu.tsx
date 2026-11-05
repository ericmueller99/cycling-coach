import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SparkleIcon } from '../../components/icons';

/**
 * The composer's ideas for a first message. Picking one fills the input and leaves sending to the
 * athlete, so the words can be changed first (DECISIONS #85). Closes on Esc and on a click elsewhere.
 */
export function SuggestionsMenu({ prompts, onPick }: { prompts: readonly string[]; onPick: (prompt: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector('button')?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll('button') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium whitespace-nowrap text-[#3A414D] ${open ? 'bg-bg' : 'bg-surface'}`}
      >
        <SparkleIcon size={14} />
        Suggestions
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Suggested prompts"
          onKeyDown={onKeyDown}
          className="absolute bottom-full left-0 z-30 mb-2 flex w-[300px] max-w-[calc(100vw-48px)] flex-col rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_12px_32px_rgba(21,24,30,.12)]"
        >
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(p);
              }}
              className="flex min-h-11 items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-3 text-left text-[14px] text-ink hover:bg-bg"
            >
              <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-accent-ring" />
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
