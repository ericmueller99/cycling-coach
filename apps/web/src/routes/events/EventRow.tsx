import type { EventItem, ZwiftEventPen } from '@cycling-coach/shared';
import { CalendarAddIcon, CheckIcon, ExternalIcon } from '../../components/icons';
import { badgesOf, calendarInputFor, penNoteOf, relLabel, statsOf, timeLabel, TYPE_STYLE, whereOf, zwiftEventUrl } from '../../lib/events';
import { errorMessage, useAddEventToCalendar } from '../../lib/queries';

/** The public feed has no sign-up counts; only the logged-in feed does. */
const counted = (e: EventItem) => e.seenVia === 'extended';

/** Popularity bar: square-root scale against the busiest event loaded, so small fields still show. */
export const popPct = (n: number, max: number) => Math.max(4, Math.round(Math.sqrt(n / Math.max(1, max)) * 100));

function Badges({ e }: { e: EventItem }) {
  const badges = badgesOf(e);
  if (!badges.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.text} className="rounded-[5px] px-1.5 text-[11px] leading-[18px] font-semibold" style={{ color: b.fg, background: b.bg }}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

function TypeTag({ e }: { e: EventItem }) {
  const s = TYPE_STYLE[e.type];
  return (
    <span className="flex-none rounded-md px-[7px] py-px text-[11px] font-semibold" style={{ color: s.fg, background: s.bg }}>
      {s.label}
    </span>
  );
}

function penBox(e: EventItem, p: ZwiftEventPen) {
  const mine = p.id === e.me.myPenId && e.me.canEnter !== false;
  if (mine) return { bg: '#C8F25A', fg: '#0E1014', border: '#7DA30A' };
  const closed = e.categoryEnforced && e.me.canEnter !== null && !e.me.enterablePenIds.includes(p.id);
  return closed ? { bg: '#F3F4F6', fg: '#9AA1AD', border: '#E3E6EB' } : { bg: '#FFFFFF', fg: '#4B5563', border: '#E3E6EB' };
}

/** The pens column, by what the pens are. */
function Pens({ e }: { e: EventItem }) {
  const note = penNoteOf(e);
  return (
    <div className="flex w-[132px] flex-none flex-col gap-1">
      {e.penKind === 'distance' ? (
        <div className="flex flex-col gap-0.5">
          {e.pens.map((p) => {
            const hit = e.me.matchedPenIds.includes(p.id);
            return (
              <div
                key={p.id}
                className="flex justify-between gap-1.5 rounded-[5px] px-1.5 text-[11px] leading-[19px]"
                style={{ background: hit ? '#C8F25A' : '#F3F4F6', color: hit ? '#0E1014' : '#4B5563' }}
              >
                <span style={{ fontWeight: hit ? 700 : 500 }}>{p.name}</span>
                <span className="font-mono">{p.km !== undefined ? `${p.km.toFixed(1)} km` : p.durationMin ? `${p.durationMin} min` : '—'}</span>
              </div>
            );
          })}
        </div>
      ) : e.penKind === 'none' ? (
        <div className="flex gap-[3px]">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-line bg-surface text-[11px] font-bold text-[#4B5563]">—</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-[3px]">
          {e.pens.map((p) => {
            const s = penBox(e, p);
            const title = p.paceFrom ? `${p.name}: ${p.paceFrom}–${p.paceTo} W/kg` : p.rangeLabel ? `${p.name}: ${p.rangeLabel}` : p.name;
            return (
              <span
                key={p.id}
                title={title}
                className="flex h-[22px] w-[22px] items-center justify-center rounded-md border text-[11px] font-bold"
                style={{ background: s.bg, color: s.fg, borderColor: s.border }}
              >
                {p.name.slice(0, 1)}
              </span>
            );
          })}
        </div>
      )}
      <span className="text-[11px]" style={{ color: note.fg }}>
        {note.text}
      </span>
    </div>
  );
}

function AddButton({ e, timeZone, big }: { e: EventItem; timeZone: string; big?: boolean }) {
  const add = useAddEventToCalendar();
  const on = Boolean(e.me.calendarEventId) || add.isSuccess;
  const label = on ? `${e.name} is on your calendar` : `Add ${e.name} to calendar`;
  return (
    <button
      type="button"
      aria-label={label}
      title={add.error ? errorMessage(add.error) : on ? 'On your calendar' : 'Add to calendar'}
      aria-disabled={on || add.isPending}
      onClick={() => !on && !add.isPending && add.mutate(calendarInputFor(e, timeZone))}
      className={`flex items-center justify-center gap-2 rounded-[10px] border text-ink ${big ? 'min-h-10 flex-1 px-3 text-[13px] font-medium' : 'h-10 w-10'} ${on ? 'border-[#B7E4C7] bg-[#F0FAF3] text-success' : add.error ? 'border-danger bg-surface' : 'border-line-strong bg-surface'}`}
    >
      {on ? <CheckIcon size={17} /> : <CalendarAddIcon size={17} />}
      {big && (on ? 'On calendar' : add.isPending ? 'Adding…' : 'Add to calendar')}
    </button>
  );
}

function SignUpLink({ e, big }: { e: EventItem; big?: boolean }) {
  return (
    <a
      href={zwiftEventUrl(e.id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={big ? undefined : `Sign up for ${e.name} on zwift.com`}
      className={`flex items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-surface text-ink no-underline hover:text-ink ${big ? 'min-h-10 flex-1 px-3 text-[13px] font-medium' : 'h-10 w-10'}`}
    >
      {big ? 'Sign up in Zwift ↗' : <ExternalIcon />}
    </a>
  );
}

/** One desktop row: time · name · stats · pens · signed up · actions. */
export function EventRow({ e, timeZone, now, maxSignedUp }: { e: EventItem; timeZone: string; now: Date; maxSignedUp: number }) {
  const stats = statsOf(e);
  const dim = e.womenOnly || e.me.canEnter === false;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3" style={{ background: dim ? '#FCFCFD' : '#FFFFFF' }}>
      <div className="flex w-[74px] flex-none flex-col leading-[1.3] whitespace-nowrap">
        <span className="font-mono text-[13px] font-semibold">{timeLabel(e.start, timeZone)}</span>
        <span className="text-[11px] text-muted">{relLabel(e.start, now, timeZone)}</span>
      </div>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
        <div className="flex min-w-0 items-center gap-2">
          <TypeTag e={e} />
          <span className={`truncate font-semibold ${dim ? 'text-muted' : ''}`} title={e.name}>
            {e.name}
          </span>
        </div>
        <div className="text-xs text-muted">{whereOf(e)}</div>
        <Badges e={e} />
      </div>
      <div className="flex w-[116px] flex-none flex-col font-mono text-xs leading-[1.45]">
        <span>{stats.km ? <><strong className="text-[13px]">{stats.km}</strong> km</> : stats.dur ? 'Timed' : '—'}</span>
        <span className="text-muted">{[stats.elev && `${stats.elev} m`, stats.terrain].filter(Boolean).join(' · ')}</span>
        <span className="text-muted">{stats.dur}</span>
      </div>
      <Pens e={e} />
      <div className="flex w-24 flex-none flex-col gap-[3px]">
        <span className="font-mono text-[13px] font-semibold" title={counted(e) ? undefined : 'Sign-up counts come with Get more events'}>
          {counted(e) ? `${e.signedUp} in` : '—'}
        </span>
        {counted(e) && (
          <div className="h-1 overflow-hidden rounded-sm bg-hover">
            <div className="h-full bg-[#3B8BF6]" style={{ width: `${popPct(e.signedUp, maxSignedUp)}%` }} />
          </div>
        )}
        <span className="text-[11px] text-muted">{e.friends ? `${e.friends} friend${e.friends === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div className="flex flex-none gap-1.5">
        <AddButton e={e} timeZone={timeZone} />
        <SignUpLink e={e} />
      </div>
    </div>
  );
}

/** One mobile card. */
export function EventCard({ e, timeZone }: { e: EventItem; timeZone: string }) {
  const stats = statsOf(e);
  const mine = e.pens.find((p) => p.id === e.me.myPenId);
  return (
    <article className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] font-semibold">{timeLabel(e.start, timeZone)}</span>
        <TypeTag e={e} />
        <span className="flex-auto" />
        {counted(e) && <span className="font-mono text-xs font-semibold text-muted">{e.signedUp} in</span>}
      </div>
      <div>
        <div className="font-semibold">{e.name}</div>
        <div className="text-xs text-muted">{whereOf(e)}</div>
      </div>
      <div className="flex items-center gap-2 font-mono text-xs">
        <span>
          {stats.km && (
            <>
              <strong className="text-[13px]">{stats.km}</strong> km{stats.elev ? ` · ${stats.elev} m` : ''}
              {stats.dur ? ' · ' : ''}
            </>
          )}
          {stats.dur}
        </span>
        <span className="flex-auto" />
        {mine && e.penKind === 'category' && e.me.canEnter !== false && (
          <span className="rounded-md border border-accent-ring bg-accent px-1.5 font-sans text-[11px] leading-5 font-bold text-on-accent">Pen {mine.name}</span>
        )}
      </div>
      {e.penKind === 'distance' && (
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
          {e.pens.map((p) => {
            const hit = e.me.matchedPenIds.includes(p.id);
            return (
              <span key={p.id} className="flex-none rounded-full px-2.5 text-xs leading-6" style={{ background: hit ? '#C8F25A' : '#F3F4F6', color: hit ? '#0E1014' : '#4B5563', fontWeight: hit ? 700 : 500 }}>
                {p.name} {p.km !== undefined ? `${p.km.toFixed(0)} km` : ''}
              </span>
            );
          })}
        </div>
      )}
      <Badges e={e} />
      <div className="flex gap-2">
        <AddButton e={e} timeZone={timeZone} big />
        <SignUpLink e={e} big />
      </div>
    </article>
  );
}
