import type { ReactNode } from 'react';
import { SearchIcon } from '../../components/icons';

/** The search field at the top of each Library tab. */
export function SearchBox({ value, onChange, placeholder, children }: { value: string; onChange: (v: string) => void; placeholder: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-[220px] flex-[1_1_280px] items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3">
        <SearchIcon size={16} className="flex-none text-muted" />
        <input
          type="search"
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-10 min-w-0 flex-auto border-0 bg-transparent text-ink outline-none mobile:min-h-[44px]"
        />
      </label>
      {children}
    </div>
  );
}

/** Dashed empty-state box. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[14px] border border-dashed border-line-strong bg-surface p-6 text-center text-[13px] text-muted">{children}</div>;
}

/** "today", "yesterday", "N days ago" from two ISO dates. */
export function daysAgo(date: string, today: string): string {
  const d = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
