import { formatShortDate, trendChange, wattsPerKg, zwiftCategoryTable } from '@cycling-coach/core';
import type { Goal, Profile } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useRestDayBudget } from '../../lib/budget';
import { untilLabel } from '../../lib/eventInfo';
import { fmtKcal } from '../../lib/food';
import { useWeightHistory } from '../../lib/queries';
import type { AthleteTab } from './AthletePage';

function SnapTile({ tab, label, value, children }: { tab: AthleteTab; label: string; value: ReactNode; children: ReactNode }) {
  return (
    <Link
      to="/athlete/$tab"
      params={{ tab }}
      className="flex min-w-0 flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-3 py-2.5 text-ink no-underline hover:border-line-strong hover:text-ink mobile:w-[150px] mobile:flex-none"
    >
      <span className="truncate text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{label}</span>
      <span className="font-mono text-[20px] leading-tight font-semibold">{value}</span>
      <span className="truncate text-xs text-muted">{children}</span>
    </Link>
  );
}

/**
 * The Athlete header's five tiles: FTP, trend weight, Zwift category, rest-day
 * budget, main goal. Each links to the tab that holds it. Scrolls sideways on phones.
 */
export function Snapshot({ profile, mainGoal, today }: { profile: Profile; mainGoal: Goal | undefined; today: string }) {
  const history = useWeightHistory();
  const change = trendChange(history.data?.points ?? [], 30);
  const rest = useRestDayBudget(today);
  const z = profile.zwift;
  const rows = zwiftCategoryTable({ zftp: z?.zftp, zmap: z?.zmap, weightKg: profile.zwiftWeightKg ?? profile.weightKg });
  const category = z?.category ?? rows?.find((r) => r.state === 'current')?.category;
  const closest = rows?.find((r) => r.state === 'closest');
  const p = mainGoal?.progress;
  // An event as the main goal has a day, not a measure (DECISIONS #100).
  const eventDay = mainGoal?.event ? mainGoal.targetDate : undefined;

  return (
    <div className="grid grid-cols-5 gap-2 mobile:flex mobile:scrollbar-none mobile:overflow-x-auto mobile:px-4 mobile:pb-2.5">
      <SnapTile tab="performance" label="FTP" value={profile.ftpZwift ?? '—'}>
        {profile.ftpZwift ? `W · ${wattsPerKg(profile.ftpZwift, profile.weightKg).toFixed(2)} W/kg` : 'Not set yet'}
      </SnapTile>
      <SnapTile tab="body" label="Trend weight" value={profile.weightKg.toFixed(1)}>
        kg
        {change !== undefined && (
          <span className={change > 0 ? 'text-[#B54708]' : change < 0 ? 'text-success' : ''}>
            {' '}
            · {change > 0 ? '+' : ''}
            {change.toFixed(1)} / 30 d
          </span>
        )}
      </SnapTile>
      <SnapTile tab="performance" label="Zwift category" value={category ?? '—'}>
        {closest?.gap ? (
          <span className="text-accent-ink">
            {closest.category} is +{closest.gap.watts} W {closest.gap.metric === 'zftp' ? 'zFTP' : 'zMAP'}
          </span>
        ) : category ? (
          'top category'
        ) : (
          'no zFTP yet'
        )}
      </SnapTile>
      <SnapTile tab="body" label="Rest-day budget" value={rest ? fmtKcal(rest.total) : '—'}>
        {rest ? 'kcal + rides' : 'set your RMR'}
      </SnapTile>
      <SnapTile
        tab="goals"
        label={mainGoal ? `Main goal · ${mainGoal.title}` : 'Main goal'}
        value={p ? p.current : eventDay ? `${formatShortDate(eventDay)}, ${eventDay.slice(0, 4)}` : '—'}
      >
        {p ? (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 flex-auto overflow-hidden rounded-[3px] bg-track">
              <span className="block h-full bg-accent-ink" style={{ width: `${Math.round(Math.min(1, Math.max(0, p.fraction)) * 100)}%` }} />
            </span>
            <span className="font-mono">{p.target}</span>
          </span>
        ) : eventDay ? (
          untilLabel(eventDay, today) || 'event'
        ) : mainGoal ? (
          'no data yet'
        ) : (
          'none set'
        )}
      </SnapTile>
    </div>
  );
}
