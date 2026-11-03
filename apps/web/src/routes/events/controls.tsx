import { penLetters, terrains, zwiftEventTypes, type EventFilters, type EventQueryResult } from '@cycling-coach/shared';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Chip, Segmented } from '../../components/ui';
import { LENGTH_PRESETS, POPULARITY, SERIES, TERRAIN, TIMES_OF_DAY, TYPE_STYLE, UNLOCKS, toggle, withFilter } from '../../lib/events';

/**
 * The filter controls, shared by the desktop rail and the mobile filters sheet.
 * Each section edits the filters in place; the page keeps them in the URL.
 */

export type SetFilters = (next: EventFilters) => void;
export interface SectionProps {
  f: EventFilters;
  set: SetFilters;
  /** Sheet styling: bigger targets, chips instead of checkbox rows. */
  mobile?: boolean | undefined;
}

export function SectionTitle({ children, mobile, htmlFor }: { children: ReactNode; mobile?: boolean | undefined; htmlFor?: string }) {
  const cls = mobile ? 'font-semibold' : 'text-xs font-semibold tracking-[0.06em] text-muted uppercase';
  return htmlFor ? (
    <label htmlFor={htmlFor} className={cls}>
      {children}
    </label>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function CheckRow({ checked, onChange, children, right }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; right?: ReactNode }) {
  return (
    <label className="flex min-h-[34px] items-center gap-2.5 text-[13px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-[18px] w-[18px] accent-accent-ink" />
      <span className="flex-auto">{children}</span>
      {right}
    </label>
  );
}

export function SwitchRow({ on, onChange, label, hint, mobile }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string | undefined; mobile?: boolean | undefined }) {
  const w = mobile ? 44 : 38;
  const h = mobile ? 26 : 22;
  const k = mobile ? 20 : 16;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex ${mobile ? 'min-h-[52px]' : 'min-h-12'} items-center gap-2.5 border-0 bg-transparent py-1.5 text-left text-ink`}
    >
      <span className="flex flex-auto flex-col leading-[1.3]">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <span className="relative flex-none rounded-full" style={{ width: w, height: h, background: on ? '#3F6212' : '#C5CBD4' }}>
        <span
          className="absolute rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left]"
          style={{ top: (h - k) / 2, left: on ? w - k - 3 : 3, width: k, height: k }}
        />
      </span>
    </button>
  );
}

const inputCls = 'min-h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-ink mobile:min-h-[44px] mobile:text-base';

/** A number input that edits on blur/Enter-free typing, but lets the field be empty. */
function NumberInput({ value, onChange, placeholder, label, className = '' }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder: string; label: string; className?: string }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value === '' ? undefined : Number(e.target.value);
        if (n === undefined || (Number.isFinite(n) && n >= 0)) onChange(n);
      }}
      className={`${inputCls} font-mono text-[13px] ${className}`}
    />
  );
}

// ── Sections ──────────────────────────────────────────────────────────────

export function WhenSection({ f, set, mobile }: SectionProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle mobile={mobile}>When</SectionTitle>
      <SwitchRow mobile={mobile} on={f.upcoming} onChange={(upcoming) => set({ ...f, upcoming })} label="Upcoming only" hint="Hide events that have already started" />
      <Segmented
        label="Day"
        value={f.day}
        onChange={(day) => set({ ...f, day })}
        options={[
          { key: 'all', label: 'Both days' },
          { key: 'today', label: 'Today' },
          { key: 'tomorrow', label: 'Tomorrow' },
        ]}
      />
      <div className="flex flex-wrap gap-1.5">
        {TIMES_OF_DAY.map((t) => (
          <Chip key={t.key} mobile={mobile} on={f.timesOfDay.includes(t.key)} onClick={() => set({ ...f, timesOfDay: toggle(f.timesOfDay, t.key) })}>
            {t.label}
          </Chip>
        ))}
      </div>
      {!mobile && (
        <div className="flex items-center gap-2 text-[13px]">
          <label htmlFor={`${id}-from`} className="text-muted">
            From
          </label>
          <input id={`${id}-from`} type="time" value={f.from ?? ''} onChange={(e) => set(withFilter(f, 'from', e.target.value || undefined))} className={`${inputCls} flex-1`} />
          <label htmlFor={`${id}-to`} className="text-muted">
            to
          </label>
          <input id={`${id}-to`} type="time" value={f.to ?? ''} onChange={(e) => set(withFilter(f, 'to', e.target.value || undefined))} className={`${inputCls} flex-1`} />
        </div>
      )}
    </div>
  );
}

export function TypeSection({ f, set, mobile, facets }: SectionProps & { facets: EventQueryResult['facets'] | undefined }) {
  const types = zwiftEventTypes;
  if (mobile) {
    return (
      <div className="flex flex-col gap-2">
        <SectionTitle mobile>Event type</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => {
            const on = f.types.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => set({ ...f, types: toggle(f.types, t) })}
                className={`min-h-[36px] rounded-full border px-3 text-[13px] ${on ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'}`}
              >
                {TYPE_STYLE[t].label} · {facets?.types[t] ?? 0}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <SectionTitle>Event type</SectionTitle>
      {types.map((t) => (
        <label key={t} className="flex min-h-9 items-center gap-2.5">
          <input type="checkbox" checked={f.types.includes(t)} onChange={() => set({ ...f, types: toggle(f.types, t) })} className="h-[18px] w-[18px] accent-accent-ink" />
          <span className="h-2 w-2 rounded-full" style={{ background: TYPE_STYLE[t].dot }} />
          <span className="flex-auto">{TYPE_STYLE[t].label}</span>
          <span className="font-mono text-xs text-muted">{facets?.types[t] ?? 0}</span>
        </label>
      ))}
    </div>
  );
}

export function LengthSection({ f, set, mobile }: SectionProps) {
  const presets = LENGTH_PRESETS[f.lengthUnit];
  const unit = f.lengthUnit === 'km' ? 'km' : 'min';
  const setRange = (lengthMin: number | undefined, lengthMax: number | undefined) => set(withFilter(withFilter(f, 'lengthMin', lengthMin), 'lengthMax', lengthMax));
  const any = f.lengthMin === undefined && f.lengthMax === undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionTitle mobile={mobile}>Length</SectionTitle>
        <div role="group" aria-label="Length unit" className="flex rounded-lg bg-hover p-0.5">
          {(['km', 'min'] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={f.lengthUnit === u}
              onClick={() => set({ ...withFilter(withFilter(f, 'lengthMin', undefined), 'lengthMax', undefined), lengthUnit: u })}
              className={`min-h-[26px] rounded-md border-0 px-2 text-xs ${f.lengthUnit === u ? 'bg-surface font-semibold text-ink' : 'bg-transparent text-muted'}`}
            >
              {u === 'km' ? 'km' : 'time'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!mobile && (
          <Chip on={any} onClick={() => setRange(undefined, undefined)}>
            Any
          </Chip>
        )}
        {presets.map(([label, lo, hi]) => {
          const on = f.lengthMin === lo && f.lengthMax === hi;
          return (
            <Chip key={label} mobile={mobile} on={on} onClick={() => (on ? setRange(undefined, undefined) : setRange(lo, hi))}>
              {label}
            </Chip>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-[13px]">
        <NumberInput label={`Minimum ${unit}`} placeholder={`min ${unit}`} value={f.lengthMin} onChange={(v) => setRange(v, f.lengthMax)} className="flex-1" />
        <span className="text-muted">–</span>
        <NumberInput label={`Maximum ${unit}`} placeholder={`max ${unit}`} value={f.lengthMax} onChange={(v) => setRange(f.lengthMin, v)} className="flex-1" />
      </div>
    </div>
  );
}

export function TerrainSection({ f, set, mobile }: SectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle mobile={mobile}>Terrain</SectionTitle>
      <div className={`grid gap-1.5 ${mobile ? 'grid-cols-4' : 'grid-cols-2'}`}>
        {terrains.map((t) => {
          const on = f.terrain.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => set({ ...f, terrain: toggle(f.terrain, t) })}
              className={`flex min-h-11 flex-col justify-center rounded-[10px] border px-2.5 py-1 text-left leading-tight text-ink ${on ? 'border-accent-ring bg-accent-tint' : 'border-line-strong bg-surface'} ${mobile ? 'items-center text-center' : ''}`}
            >
              <span className="text-[13px] font-semibold">{TERRAIN[t].label}</span>
              {!mobile && <span className="text-[11px] text-muted">{TERRAIN[t].hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WorldSection({ f, set, mobile, facets }: SectionProps & { facets: EventQueryResult['facets'] | undefined }) {
  const id = useId();
  const worlds = Object.entries(facets?.worlds ?? {})
    .concat(f.worlds.filter((w) => !facets?.worlds[w]).map((w) => [w, 0] as [string, number]))
    .sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-col gap-1">
      <SectionTitle mobile={mobile}>World</SectionTitle>
      {worlds.length === 0 && <div className="text-[13px] text-muted">No events synced yet.</div>}
      {worlds.map(([w, n]) => (
        <CheckRow key={w} checked={f.worlds.includes(w)} onChange={() => set({ ...f, worlds: toggle(f.worlds, w) })} right={<span className="font-mono text-xs text-muted">{n}</span>}>
          {w}
        </CheckRow>
      ))}
      <label htmlFor={`${id}-route`} className="mt-1 text-xs text-muted">
        Route
      </label>
      <input
        id={`${id}-route`}
        type="text"
        placeholder="Any route"
        value={f.route ?? ''}
        onChange={(e) => set(withFilter(f, 'route', e.target.value.slice(0, 60) || undefined))}
        className={`${inputCls} px-2.5 text-[13px]`}
      />
    </div>
  );
}

export function PopularitySection({ f, set, mobile }: SectionProps) {
  const preset = f.minSignedUp === 0 || POPULARITY.includes(f.minSignedUp);
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle mobile={mobile}>Popularity · signed up</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        <Chip mobile={mobile} on={f.minSignedUp === 0} onClick={() => set({ ...f, minSignedUp: 0 })}>
          Any
        </Chip>
        {POPULARITY.map((n) => (
          <Chip key={n} mobile={mobile} on={f.minSignedUp === n} onClick={() => set({ ...f, minSignedUp: f.minSignedUp === n ? 0 : n })}>
            {n}+
          </Chip>
        ))}
        {mobile && (
          <Chip mobile on={f.friends} onClick={() => set({ ...f, friends: !f.friends })}>
            Friends in
          </Chip>
        )}
      </div>
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-muted">Custom: at least</span>
        <NumberInput
          label="At least this many signed up"
          placeholder="e.g. 30"
          value={preset ? undefined : f.minSignedUp}
          onChange={(v) => set({ ...f, minSignedUp: Math.round(v ?? 0) })}
          className={`w-[72px] ${preset ? '' : 'border-accent-ring'}`}
        />
        <span className="text-muted">signed up</span>
      </div>
      {!mobile && (
        <CheckRow checked={f.friends} onChange={(friends) => set({ ...f, friends })}>
          Friends signed up
        </CheckRow>
      )}
      <div className="text-xs text-muted">Sign-up counts need “Get more events” — the public feed doesn’t have them.</div>
    </div>
  );
}

export function ForMeSection({ f, set, mobile, z2 }: SectionProps & { z2?: string | undefined }) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionTitle mobile={mobile}>For me</SectionTitle>
      <SwitchRow mobile={mobile} on={f.canEnter} onChange={(canEnter) => set({ ...f, canEnter })} label="Only events I can enter" hint="Uses your zFTP, zMAP, Racing Score, weight" />
      <SwitchRow mobile={mobile} on={f.fitsZ2} onChange={(fitsZ2) => set({ ...f, fitsZ2 })} label="Fits a Z2 ride" hint={z2 ? `Pace inside ${z2} W/kg` : 'A pace group inside your Z2'} />
      <SwitchRow mobile={mobile} on={f.hasUnlock} onChange={(hasUnlock) => set({ ...f, hasUnlock })} label="Has an unlock" hint="Jersey, kit, badge or bike" />
    </div>
  );
}

export function PensSection({ f, set, mobile }: SectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle mobile={mobile}>Category &amp; pens</SectionTitle>
      <div className="flex gap-1.5">
        {penLetters.map((l) => {
          const on = f.pens.includes(l);
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              onClick={() => set({ ...f, pens: toggle(f.pens, l) })}
              className={`min-h-9 flex-1 rounded-lg font-semibold mobile:min-h-[44px] ${on ? 'border-0 bg-accent font-bold text-on-accent' : 'border border-line-strong bg-surface text-ink'}`}
            >
              {l}
            </button>
          );
        })}
      </div>
      <div className="text-xs text-muted">Pens split by</div>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['category', 'Category'],
            ['pace', 'Pace'],
            ['distance', 'Distance options'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex min-h-8 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-[13px] mobile:min-h-[44px]">
            <input
              type="checkbox"
              checked={f.penKinds.length === 0 || f.penKinds.includes(k)}
              onChange={() => {
                const all = ['category', 'pace', 'distance', 'none'] as const;
                const current = f.penKinds.length ? f.penKinds : [...all];
                const next = toggle(current, k);
                set({ ...f, penKinds: next.length === all.length ? [] : next });
              }}
              className="h-4 w-4 accent-accent-ink"
            />
            {label}
          </label>
        ))}
      </div>
      <div className="text-xs text-muted">With distance options, length and terrain filters match any option; the matching ones are highlighted.</div>
      <Segmented
        small
        label="Pen rules"
        value={f.penBasis}
        onChange={(penBasis) => set({ ...f, penBasis })}
        options={[
          { key: 'any', label: 'Any' },
          { key: 'zftp', label: 'zFTP pens' },
          { key: 'racing_score', label: 'Racing Score' },
        ]}
      />
      <CheckRow checked={f.enforcedOnly} onChange={(enforcedOnly) => set({ ...f, enforcedOnly })}>
        Category enforced only
      </CheckRow>
      <CheckRow checked={f.rankedOnly} onChange={(rankedOnly) => set({ ...f, rankedOnly })}>
        Ranked (results count)
      </CheckRow>
    </div>
  );
}

export function RulesSection({ f, set, mobile }: SectionProps) {
  return (
    <div className="flex flex-col gap-1">
      <SectionTitle mobile={mobile}>Rules</SectionTitle>
      <div className="mb-1">
        <Segmented
          small
          label="Power-ups"
          value={f.powerups}
          onChange={(powerups) => set({ ...f, powerups })}
          options={[
            { key: 'any', label: 'Any' },
            { key: 'yes', label: 'Power-ups' },
            { key: 'no', label: 'No power-ups' },
          ]}
        />
      </div>
      <CheckRow checked={f.lateJoin} onChange={(lateJoin) => set({ ...f, lateJoin })}>
        Late join allowed
      </CheckRow>
      <CheckRow checked={f.noDrafting} onChange={(noDrafting) => set({ ...f, noDrafting })}>
        No drafting
      </CheckRow>
      <CheckRow checked={f.ttBikes} onChange={(ttBikes) => set({ ...f, ttBikes })}>
        TT bikes allowed
      </CheckRow>
      <CheckRow checked={f.hrmRequired} onChange={(hrmRequired) => set({ ...f, hrmRequired })}>
        Heart-rate monitor required
      </CheckRow>
      <CheckRow checked={f.hideWomenOnly} onChange={(hideWomenOnly) => set({ ...f, hideWomenOnly })}>
        Hide women-only events
      </CheckRow>
    </div>
  );
}

export function UnlocksSection({ f, set, mobile }: SectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle mobile={mobile}>Unlocks</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {UNLOCKS.map((u) => (
          <Chip key={u.key} mobile={mobile} on={f.unlocks.includes(u.key)} onClick={() => set({ ...f, unlocks: toggle(f.unlocks, u.key) })}>
            {u.label}
          </Chip>
        ))}
      </div>
      <div className="text-xs text-muted">Read from event tags and description — may miss some.</div>
    </div>
  );
}

export function SeriesSection({ f, set, mobile }: SectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle mobile={mobile}>Series</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {SERIES.map((s) => (
          <Chip key={s.key} mobile={mobile} on={f.series.includes(s.key)} onClick={() => set({ ...f, series: toggle(f.series, s.key) })}>
            {s.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function StatusSection({ f, set, mobile }: SectionProps) {
  return (
    <div className="flex flex-col gap-1">
      <SectionTitle mobile={mobile}>My status</SectionTitle>
      <CheckRow checked={f.signedUpOnly} onChange={(signedUpOnly) => set({ ...f, signedUpOnly })}>
        Signed up only
      </CheckRow>
      <CheckRow checked={f.onCalendar} onChange={(onCalendar) => set({ ...f, onCalendar })}>
        On my calendar
      </CheckRow>
      <div className="text-xs text-muted">Sign-ups show after “Get more events” (they need your Zwift login).</div>
    </div>
  );
}
