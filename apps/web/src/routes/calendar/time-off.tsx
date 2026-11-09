import { formatLongDay, sessionsInSpan, spanPosition } from '@cycling-coach/core';
import { TIME_OFF_LABEL, timeOffKinds, type IsoDate, type TimeOff, type TimeOffKind } from '@cycling-coach/shared';
import { useState, type CSSProperties } from 'react';
import { Sheet } from '../../components/Sheet';
import { Button, ErrorNote, SectionLabel } from '../../components/ui';
import { errorMessage, useSessionsBetween, useTimeOffMutations } from '../../lib/queries';
import { TIME_OFF_STYLE, timeOffDates } from '../../lib/session';
import { FIELD, PANEL } from './shared';

/** How far a chip reaches past the padding of its cell, so a run of days reads as one bar. */
const CELL_PADDING = 6;

/**
 * One day of time off in the week grid. A chip that carries on squares its edge and reaches the side
 * of the cell. It's named where it starts and at the start of each week; the days between are a bar.
 */
export function TimeOffChip({ entry, date, firstInWeek, lastInWeek, onOpen }: { entry: TimeOff; date: IsoDate; firstInWeek: boolean; lastInWeek: boolean; onOpen: () => void }) {
  const s = TIME_OFF_STYLE[entry.kind];
  const position = spanPosition(entry, date);
  const fromBefore = position === 'middle' || position === 'end';
  const intoNext = position === 'middle' || position === 'start';
  const shape: CSSProperties = {
    background: s.bg,
    color: s.fg,
    borderTopLeftRadius: fromBefore ? 0 : 6,
    borderBottomLeftRadius: fromBefore ? 0 : 6,
    borderTopRightRadius: intoNext ? 0 : 6,
    borderBottomRightRadius: intoNext ? 0 : 6,
    marginLeft: fromBefore && !firstInWeek ? -CELL_PADDING : 0,
    marginRight: intoNext && !lastInWeek ? -CELL_PADDING : 0,
  };
  return (
    <button
      type="button"
      aria-label={`${TIME_OFF_LABEL[entry.kind]}, ${timeOffDates(entry)}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="min-h-[22px] truncate border-0 px-1.5 py-0.5 text-left text-xs font-semibold"
      style={shape}
    >
      {!fromBefore || firstInWeek ? TIME_OFF_LABEL[entry.kind] : ''}
    </button>
  );
}

/** Time off on a day's timeline or the week agenda. */
export function TimeOffCard({ entry, onOpen }: { entry: TimeOff; onOpen: () => void }) {
  const s = TIME_OFF_STYLE[entry.kind];
  return (
    <button type="button" onClick={onOpen} className="flex w-full min-w-0 flex-col gap-0.5 rounded-xl border-0 px-3.5 py-2.5 text-left" style={{ background: s.bg, color: s.fg }}>
      <span className="flex justify-between gap-2">
        <span className="font-semibold">{TIME_OFF_LABEL[entry.kind]}</span>
        <span className="flex-none font-mono text-xs">{timeOffDates(entry)}</span>
      </span>
      {entry.note && <span className="truncate text-xs">{entry.note}</span>}
    </button>
  );
}

/**
 * Add or change time off. Sessions still planned on those days stay where they are, so the athlete
 * is told about them and asked before it's saved.
 */
export function TimeOffPanel({
  date,
  entry,
  today,
  onClose,
  sheet = false,
}: {
  /** The first day of a new entry. */
  date?: IsoDate | undefined;
  /** The entry being edited. */
  entry?: TimeOff | undefined;
  today: IsoDate;
  onClose: () => void;
  sheet?: boolean;
}) {
  const { create, patch, remove } = useTimeOffMutations();
  const [kind, setKind] = useState<TimeOffKind>(entry?.kind ?? 'vacation');
  const [startDate, setStartDate] = useState(entry?.startDate ?? date ?? today);
  const [endDate, setEndDate] = useState(entry?.endDate ?? date ?? today);
  const [note, setNote] = useState(entry?.note ?? '');
  const [warned, setWarned] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const valid = !!startDate && !!endDate && endDate >= startDate;
  const moved = !entry || entry.startDate !== startDate || entry.endDate !== endDate;
  const check = useSessionsBetween(startDate, endDate, valid && moved);
  const clash = moved && check.data ? sessionsInSpan(check.data.events, startDate, endDate, today) : [];
  const busy = create.isPending || patch.isPending;

  const pickStart = (value: string) => {
    setWarned(false);
    setStartDate(value);
    if (value && (!endDate || endDate < value)) setEndDate(value);
  };
  const pickEnd = (value: string) => {
    setWarned(false);
    setEndDate(value);
  };

  const commit = () => {
    const trimmed = note.trim();
    const fields = { kind, startDate, endDate };
    if (entry) patch.mutate({ id: entry.id, patch: { ...fields, ...(trimmed ? { note: trimmed } : { unset: ['note'] }) } }, { onSuccess: onClose });
    else create.mutate({ ...fields, ...(trimmed ? { note: trimmed } : {}) }, { onSuccess: onClose });
  };
  const save = () => (clash.length && !warned ? setWarned(true) : commit());

  const saveLabel = entry ? 'Save' : `Add ${TIME_OFF_LABEL[kind].toLowerCase()}`;
  const form = (
    <>
      <div role="group" aria-label="Kind" className="flex w-fit rounded-[10px] border border-line-strong bg-surface p-[3px]">
        {timeOffKinds.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`min-h-[34px] rounded-lg border-0 px-3 text-[13px] ${kind === k ? 'bg-track font-semibold text-ink' : 'bg-transparent text-muted'}`}
          >
            {TIME_OFF_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 text-xs text-muted">
          First day
          <input type="date" value={startDate} onChange={(e) => pickStart(e.target.value)} className={`${FIELD} font-mono text-ink`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Last day
          <input type="date" value={endDate} min={startDate} onChange={(e) => pickEnd(e.target.value)} className={`${FIELD} font-mono text-ink`} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
          Note (optional)
          <input value={note} maxLength={500} placeholder={kind === 'sick' ? 'Head cold' : 'Family trip, no bike'} onChange={(e) => setNote(e.target.value)} className={`${FIELD} text-sm text-ink`} />
        </label>
      </div>
      {warned ? (
        <div role="alert" className="flex flex-col gap-2.5 rounded-[10px] border border-[#F3D58A] bg-[#FFF8E6] p-3 text-[13px] text-[#7A4B00]">
          <div className="font-semibold">
            You have {clash.length === 1 ? 'a session' : `${clash.length} sessions`} on these days. Continue anyway?
          </div>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {clash.map((e) => (
              <li key={e.id}>
                {formatLongDay(e.date)} · {e.title}
              </li>
            ))}
          </ul>
          <div>{clash.length === 1 ? 'It stays' : 'They stay'} on your calendar until you move or delete {clash.length === 1 ? 'it' : 'them'}.</div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setWarned(false)}>
              Back
            </Button>
            <Button variant="primary" className="flex-1" disabled={busy} onClick={commit}>
              {busy ? 'Saving…' : entry ? 'Save anyway' : 'Add anyway'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" size="lg" disabled={!valid || busy || (moved && check.isPending)} onClick={save}>
          {busy ? 'Saving…' : saveLabel}
        </Button>
      )}
      {entry &&
        !warned &&
        (confirmDelete ? (
          <span className="flex gap-2">
            <Button size="lg" variant="ghost" className="flex-1" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button size="lg" variant="danger" className="flex-1" disabled={remove.isPending} onClick={() => remove.mutate(entry.id, { onSuccess: onClose })}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </span>
        ) : (
          <Button size="lg" variant="ghost" style={{ color: '#B42318' }} onClick={() => setConfirmDelete(true)}>
            Delete…
          </Button>
        ))}
      {check.error && <ErrorNote>Couldn't check your sessions on these days: {errorMessage(check.error)}</ErrorNote>}
      {(create.error || patch.error || remove.error) && <ErrorNote>{errorMessage(create.error ?? patch.error ?? remove.error)}</ErrorNote>}
    </>
  );

  const title = entry ? TIME_OFF_LABEL[entry.kind] : 'Add time off';
  if (sheet) {
    return (
      <Sheet eyebrow="Time off" title={title} onClose={onClose}>
        <div className="flex flex-col gap-4">{form}</div>
      </Sheet>
    );
  }
  return (
    <aside aria-label="Time off" className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <SectionLabel>Time off</SectionLabel>
          <h2 className="mt-1 mb-0 text-[22px]">{title}</h2>
        </div>
        <button type="button" onClick={onClose} className="border-0 bg-transparent text-muted" aria-label="Close">
          ✕
        </button>
      </div>
      {form}
    </aside>
  );
}
