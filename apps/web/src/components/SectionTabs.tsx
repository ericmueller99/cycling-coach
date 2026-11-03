import { Link } from '@tanstack/react-router';

export interface SectionTab<K extends string> {
  key: K;
  label: string;
  /** Shown after the label ("Foods 15"). */
  count?: number | undefined;
}

/**
 * Tabs of a sectioned page (Athlete, Library): underline links on desktop, a
 * segmented control on phones. Each tab is a route (`/athlete/$tab`, `/library/$tab`).
 */
export function SectionTabs<K extends string>({
  label,
  base,
  tabs,
  active,
  mobile,
}: {
  label: string;
  base: '/athlete/$tab' | '/library/$tab';
  tabs: SectionTab<K>[];
  active: K;
  mobile: boolean;
}) {
  if (mobile) {
    return (
      <nav aria-label={label} className="mx-4 mb-2.5 grid rounded-[10px] bg-hover p-[3px]" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Link
              key={t.key}
              to={base}
              params={{ tab: t.key }}
              aria-current={on ? 'page' : undefined}
              className={`flex min-h-[36px] items-center justify-center truncate rounded-lg px-1 text-[13px] no-underline ${on ? 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:text-ink' : 'text-muted hover:text-ink'}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            to={base}
            params={{ tab: t.key }}
            aria-current={on ? 'page' : undefined}
            className={`flex-none border-b-2 px-3 py-2.5 whitespace-nowrap no-underline ${on ? 'border-ink font-semibold text-ink hover:text-ink' : 'border-transparent font-medium text-muted hover:text-ink'}`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 font-mono text-xs font-normal text-muted">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
