import { climbTimeRange, formatMeters, formatTimeRange } from '@cycling-coach/core';
import type { CalendarEvent, ZwiftRouteOption } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, ErrorNote } from '../../components/ui';
import { errorMessage, useCourse, useProfile, useZwiftFeature, useZwiftRoutes } from '../../lib/queries';
import { groupClimbs, groupSegments, parseLaps, routeTotals, searchRoutes, wherePhrase } from '../../lib/zwiftRoute';
import { ElevationProfile } from './course';
import { FIELD } from './shared';

/**
 * A Zwift race's route and laps (DECISIONS #102): picked in the race form, shown on the race's panel
 * with its profile, named climbs and sprints. Only for accounts with the Zwift feature.
 */

const LIST_LIMIT = 60;
/** More markers than this crowd the 420 px panel; the shading still shows every climb. */
const MAX_MARKERS = 12;

const routeLine = (r: Pick<ZwiftRouteOption, 'distanceKm' | 'ascentM' | 'world'>) => `${r.world ? `${r.world} · ` : ''}${r.distanceKm} km · ${formatMeters(r.ascentM)}`;

/** The race form's route field: search, pick, then laps. */
export function ZwiftRoutePicker({
  routeId,
  laps,
  onChange,
}: {
  routeId: number | null;
  laps: string;
  onChange: (p: { routeId?: number | null; laps?: string }) => void;
}) {
  const routes = useZwiftRoutes(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const picked = routeId === null ? undefined : routes.data?.find((r) => r.id === routeId);

  const label = (
    <span className="text-xs text-muted">
      Zwift route <span className="font-normal">· optional</span>
    </span>
  );

  if (routeId !== null && !searching) {
    const n = parseLaps(laps);
    const totals = picked ? routeTotals(picked, n) : null;
    return (
      <div className="col-span-2 flex flex-col gap-1">
        {label}
        <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-auto">
              <span className="block truncate text-[13px] font-semibold text-ink">{picked?.name ?? (routes.isPending ? 'Loading…' : `Route ${routeId}`)}</span>
              {picked && <span className="block font-mono text-xs text-muted">{routeLine(picked)} a lap</span>}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setSearching(true)}>
              Change
            </Button>
            <button type="button" onClick={() => onChange({ routeId: null, laps: '' })} className="min-h-8 rounded-lg border-0 bg-transparent px-2 text-xs font-medium text-muted">
              Remove
            </button>
          </div>
          <div className="flex items-end gap-2.5">
            <label className="flex w-24 flex-col gap-1 text-xs text-muted">
              Laps (optional)
              <input type="number" min={1} max={50} value={laps} placeholder="1" onChange={(e) => onChange({ laps: e.target.value })} className={`${FIELD} font-mono text-ink`} />
            </label>
            {totals && picked && (
              <span className="pb-2.5 font-mono text-xs text-muted">
                ≈ {totals.km} km · {formatMeters(totals.ascentM)}
                {picked.leadinKm > 0 ? ` · incl. ${picked.leadinKm} km lead-in` : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const found = searchRoutes(routes.data ?? [], query);
  return (
    <div className="col-span-2 flex flex-col gap-1">
      {label}
      <input
        type="search"
        placeholder="Search Zwift routes or worlds"
        value={query}
        autoFocus={searching}
        onChange={(e) => setQuery(e.target.value)}
        className={`${FIELD} text-sm text-ink`}
        aria-label="Search Zwift routes"
      />
      {(query.trim() || searching) && (
        <div role="listbox" aria-label="Zwift routes" className="flex max-h-[240px] flex-col gap-1 overflow-y-auto">
          {routes.isPending && <div className="text-[13px] text-muted">Loading…</div>}
          {routes.error && <ErrorNote>Couldn’t load the routes: {errorMessage(routes.error)}</ErrorNote>}
          {routes.data && !found.length && <div className="text-[13px] text-muted">No routes match.</div>}
          {found.slice(0, LIST_LIMIT).map((r) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={r.id === routeId}
              onClick={() => {
                onChange({ routeId: r.id });
                setSearching(false);
                setQuery('');
              }}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left"
            >
              <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{r.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted">
                {routeLine(r)}
                {!r.hasProfile && ' · no profile'}
              </span>
            </button>
          ))}
          {found.length > LIST_LIMIT && <div className="text-xs text-muted">Keep typing to narrow {found.length} routes.</div>}
          {searching && (
            <button type="button" onClick={() => setSearching(false)} className="self-start border-0 bg-transparent p-0 text-xs font-semibold text-accent-ink">
              Keep the current route
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const climbBadge = (label: number, dark: boolean) => (
  <span
    className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full font-mono text-[11px] font-semibold"
    style={{ border: `1.5px solid ${dark ? '#15181E' : '#9AA1AD'}`, background: dark ? '#15181E' : '#FFFFFF', color: dark ? '#FFFFFF' : '#15181E' }}
  >
    {label}
  </span>
);

/** The race panel's route card. Renders nothing for an account without the Zwift feature, or a race without a route. */
export function ZwiftRouteCard({ event }: { event: CalendarEvent }) {
  const allowed = useZwiftFeature();
  const show = allowed && event.kind === 'race' && event.zwiftRouteId !== undefined;
  const course = useCourse(event.id, show);
  const athlete = useProfile().data?.profile;
  if (!show) return null;
  if (course.error) return <ErrorNote>Couldn’t load the route: {errorMessage(course.error)}</ErrorNote>;
  if (course.isPending) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" aria-label="Loading the route" />;
  const data = course.data;
  if (!data?.route) return null;

  const { analysis, route } = data;
  const ftp = athlete?.ftpZwift;
  const weightKg = athlete?.weightKg;
  const { groups, labelOf } = groupClimbs(analysis);
  const segments = groupSegments(data.segments ?? []);
  const sprints = (data.segments ?? []).filter((s) => s.kind === 'sprint').map((s) => s.startKm);
  const named = groups.filter((g) => g.name);
  const other = groups.filter((g) => !g.name);
  const lapsText = route.lapsUnknown ? 'laps not set' : `${route.laps} ${route.laps === 1 ? 'lap' : 'laps'}`;

  const climbRow = (g: (typeof groups)[number]) => (
    <li key={g.label} className="flex items-start gap-2.5 border-t border-divider px-3.5 py-2.5" style={{ background: g.longest ? '#F6F7F9' : '#FFFFFF' }}>
      {climbBadge(g.label, g.longest)}
      <span className="flex min-w-0 flex-auto flex-col">
        <span className="font-semibold">
          {g.name ?? (
            <>
              <span className="font-mono">{g.first.lengthKm} km</span> at <span className="font-mono">{g.first.avgPct}%</span>
            </>
          )}
          {g.category && <span className="ml-1.5 rounded-[5px] bg-hover px-1.5 align-[1px] text-[10px] leading-[17px] font-bold text-muted">{g.category === 'HC' ? 'HC' : `Cat ${g.category}`}</span>}
          {g.longest && <span className="ml-1.5 rounded-[5px] bg-ink px-1.5 align-[1px] text-[10px] leading-[17px] font-bold text-white">Longest</span>}
        </span>
        <span className="font-mono text-xs text-muted">
          {g.name && `${g.first.lengthKm} km at ${g.first.avgPct}% · `}max {g.first.maxPct}% · +{formatMeters(g.first.gainM)} · {wherePhrase(g.startsKm)}
        </span>
      </span>
      {ftp && weightKg && (
        <span className="flex flex-none flex-col text-right">
          <span className="font-mono font-semibold">{formatTimeRange(climbTimeRange(g.first, ftp, weightKg))}</span>
          <span className="text-[11px] text-muted">for you</span>
        </span>
      )}
    </li>
  );

  return (
    <section aria-labelledby={`route-${event.id}`} className="flex flex-col rounded-xl border border-line bg-surface">
      <div className="flex flex-col gap-0.5 px-3.5 pt-3">
        <div className="flex items-baseline gap-2">
          <h3 id={`route-${event.id}`} className="m-0 min-w-0 flex-auto truncate text-[15px]">
            {route.name}
          </h3>
          <span className="shrink-0 text-xs text-muted">{route.world ? `${route.world} · ` : ''}{lapsText}</span>
        </div>
        <div className="font-mono text-xs text-muted">
          {analysis.distanceKm} km{analysis.ascentM !== null ? ` · ${formatMeters(analysis.ascentM)}` : ''}
          {route.leadinKm > 0 ? ` · lead-in ${route.leadinKm} km` : ''}
          {route.laps > 1 ? ` · ${route.lapKm} km a lap` : ''}
        </div>
      </div>

      {route.hasProfile ? (
        <div className="px-3.5 pt-2.5">
          <ElevationProfile analysis={analysis} markerLabel={labelOf} maxMarkers={MAX_MARKERS} sprints={sprints} />
        </div>
      ) : (
        <div className="px-3.5 pt-2 text-[13px] text-muted">No profile for this route yet: the distance and climbing are the route’s own.</div>
      )}

      {groups.length > 0 && (
        <ol className="m-0 mt-2 flex list-none flex-col p-0" aria-label="Climbs">
          {named.map(climbRow)}
          {other.length > 0 && named.length > 0 && <li className="border-t border-divider px-3.5 pt-2 pb-1 text-xs font-semibold text-muted">Other climbs</li>}
          {other.map(climbRow)}
        </ol>
      )}
      {segments.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0" aria-label="Sprints and segments">
          {segments.map((s) => (
            <li key={s.name} className="flex items-start gap-2.5 border-t border-divider px-3.5 py-2.5">
              <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] border-[1.5px] border-[#9AA1AD] font-mono text-[11px] font-bold">
                {s.kind === 'sprint' ? 'S' : 'T'}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{s.name}</span>
                <span className="font-mono text-xs text-muted">
                  {s.kind === 'sprint' ? 'Sprint' : 'Timed segment'} · {s.lengthKm} km · {wherePhrase(s.startsKm)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1 border-t border-divider px-3.5 pt-2.5 pb-3">
        {route.hasProfile && analysis.finishGainM !== null && analysis.distanceKm > 25 && (
          <div className="text-[13px]">
            Last 20 km: <span className="font-mono font-semibold">+{formatMeters(analysis.finishGainM)}</span>
          </div>
        )}
        {groups.length > 0 &&
          (ftp ? (
            <div className="text-xs text-muted">Climb times are estimates from your FTP and weight.</div>
          ) : (
            <div className="text-xs text-muted">
              <Link to="/athlete/$tab" params={{ tab: 'performance' }} className="font-semibold">
                Set your FTP
              </Link>{' '}
              to see climb times.
            </div>
          ))}
        {route.lapsUnknown && <div className="text-xs text-muted">No laps set, so one lap is shown. Edit the race to add them.</div>}
        {route.hasProfile && route.leadinKm > 0 && <div className="text-xs text-muted">The lead-in is drawn flat.</div>}
        {(route.zwiftInsiderUrl || route.whatsOnZwiftUrl) && (
          <div className="flex gap-3 text-xs">
            {route.zwiftInsiderUrl && (
              <a href={route.zwiftInsiderUrl} target="_blank" rel="noreferrer">
                ZwiftInsider ↗
              </a>
            )}
            {route.whatsOnZwiftUrl && (
              <a href={route.whatsOnZwiftUrl} target="_blank" rel="noreferrer">
                What’s on Zwift ↗
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
