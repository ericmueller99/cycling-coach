import type { EventItem, EventsStatus } from '@cycling-coach/shared';
import { useState } from 'react';
import { ChevronDown } from '../../components/icons';
import { agoLabel, calendarInputFor, signedUpPen, timeLabel } from '../../lib/events';
import { errorMessage, useAddEventsToCalendar, useRefreshSignups, useSignedUpEvents } from '../../lib/queries';
import { AddButton, MyPenChip, TypeTag } from './EventRow';

const OPEN_KEY = 'events.signedUp.open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage blocked: it just won't be remembered.
  }
}

const dayOf = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso)).replace(',', '');

/** One sign-up: day and time, name, the pen they're in, and Add to calendar. */
function SignedUpRow({ e, timeZone, mobile }: { e: EventItem; timeZone: string; mobile: boolean }) {
  const pen = signedUpPen(e);
  const start = pen?.start ?? e.start;
  return (
    <li className={`flex items-center gap-3 ${mobile ? 'py-2' : 'py-1.5'}`}>
      <div className="flex w-[92px] flex-none flex-col leading-[1.3] whitespace-nowrap">
        <span className="text-xs font-semibold">{dayOf(start, timeZone)}</span>
        <span className="font-mono text-xs text-muted">{timeLabel(start, timeZone)}</span>
      </div>
      <div className="flex min-w-0 flex-auto flex-col gap-1">
        <span className="truncate text-[13px] font-semibold" title={e.name}>
          {e.name}
        </span>
        <div className="flex items-center gap-1.5">
          <TypeTag e={e} />
          {pen && e.penKind !== 'none' && <MyPenChip pen={pen} />}
        </div>
      </div>
      <AddButton e={e} timeZone={timeZone} />
    </li>
  );
}

/**
 * "You're signed up": the athlete's Zwift sign-ups above the list, whatever the filters, each one
 * click from the calendar, plus Add all (DECISIONS #116). Sign-ups come from the logged-in walk
 * (Get more events, by hand or daily), so it shows only with a Zwift login.
 */
export function SignedUpStrip({ status, timeZone, now, mobile = false }: { status: EventsStatus | undefined; timeZone: string; now: Date; mobile?: boolean }) {
  const enabled = Boolean(status?.extended);
  const q = useSignedUpEvents(enabled);
  const addAll = useAddEventsToCalendar();
  const refresh = useRefreshSignups();
  const [open, setOpen] = useState(readOpen);
  if (!enabled) return null;

  const items = q.data?.items ?? [];
  const missing = items.filter((e) => !e.me.calendarEventId);
  const ext = status?.extended;
  // The newer of the last walk and the last sign-up refresh.
  const last = [ext?.finishedAt, ext?.signupsAt].filter((x): x is string => Boolean(x)).sort().pop();
  const fresh = ext?.state === 'running' ? 'Updating from Zwift…' : refresh.isPending ? 'Checking Zwift…' : last ? `From Zwift ${agoLabel(last, now)}` : 'Not read from Zwift yet';
  const waitUntil = ext?.signupsAllowedAt && Date.parse(ext.signupsAllowedAt) > now.getTime() ? ext.signupsAllowedAt : undefined;
  const elsewhere = refresh.data?.elsewhere ?? [];
  const toggle = () => {
    setOpen(!open);
    writeOpen(!open);
  };

  return (
    <section aria-label="Events you're signed up for" className={`rounded-[14px] border border-[#B7E4C7] bg-[#F0FAF3] ${mobile ? 'mb-3 p-3' : 'mx-6 mt-3.5 px-4 py-3'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-expanded={open} onClick={toggle} className="flex min-h-9 items-center gap-1.5 border-0 bg-transparent p-0 text-left text-ink">
          <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="font-semibold">You’re signed up{q.data ? ` · ${items.length}` : ''}</span>
        </button>
        <span className="text-xs text-muted">{fresh}</span>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || Boolean(waitUntil) || ext?.state === 'running'}
          title={waitUntil ? `Checked recently — again from ${timeLabel(waitUntil, timeZone)}` : 'Ask Zwift for your sign-ups now (one request)'}
          className="min-h-9 border-0 bg-transparent px-1 text-[13px] font-semibold text-accent-ink disabled:text-muted"
        >
          {refresh.isPending ? 'Refreshing…' : 'Refresh'}
        </button>
        <span className="grow" />
        {missing.length > 0 && (
          <button
            type="button"
            disabled={addAll.isPending}
            onClick={() => addAll.mutate(missing.map((e) => calendarInputFor(e, timeZone)))}
            className="min-h-9 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink disabled:opacity-60"
          >
            {addAll.isPending ? 'Adding…' : `Add ${missing.length === 1 ? 'it' : `all ${missing.length}`} to calendar`}
          </button>
        )}
      </div>
      {refresh.error ? (
        <p role="alert" className="m-0 mt-1 text-xs text-danger">
          {errorMessage(refresh.error)}
        </p>
      ) : null}
      {elsewhere.length ? (
        <p className="m-0 mt-1 text-xs text-muted">
          Also signed up beyond the synced events: {elsewhere.map((s) => `${s.name ?? `event ${s.eventId}`}${s.start ? ` (${dayOf(s.start, timeZone)})` : ''}`).join(', ')}. They show here once Get more events reaches them.
        </p>
      ) : null}
      {addAll.data?.failed.length ? (
        <p role="alert" className="m-0 mt-1 text-xs text-danger">
          Couldn’t add: {addAll.data.failed.join(', ')}
        </p>
      ) : null}
      {addAll.error ? (
        <p role="alert" className="m-0 mt-1 text-xs text-danger">
          {errorMessage(addAll.error)}
        </p>
      ) : null}
      {open &&
        (q.error ? (
          <p className="m-0 mt-1 text-xs text-danger">{errorMessage(q.error)}</p>
        ) : items.length ? (
          <ul className={`m-0 mt-1 list-none divide-y divide-[#D5EEDD] p-0 ${mobile ? '' : 'max-h-[232px] overflow-y-auto'}`}>
            {items.map((e) => (
              <SignedUpRow key={e.id} e={e} timeZone={timeZone} mobile={mobile} />
            ))}
          </ul>
        ) : q.data ? (
          <p className="m-0 mt-1 text-[13px] text-muted">
            No upcoming sign-ups found. Signed up in Zwift since? Press Refresh.
          </p>
        ) : null)}
    </section>
  );
}
