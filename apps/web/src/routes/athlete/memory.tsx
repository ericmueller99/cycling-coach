import { addDays, formatLongDay, isShortTerm, needsReview } from '@cycling-coach/core';
import type { IsoDate, Memory } from '@cycling-coach/shared';
import { useState } from 'react';
import { PencilIcon, TrashIcon } from '../../components/icons';
import { Button, Card, ErrorNote, Tag } from '../../components/ui';
import { errorMessage, useProfileMutations } from '../../lib/queries';

const INPUT = 'min-h-10 rounded-lg border border-line-strong px-2 text-[13px]';
const AMBER_TAG = 'rounded-[5px] bg-[#FEF3E7] px-1.5 text-[11px] leading-[18px] font-bold text-[#B54708]';

const sourceLabel = (m: Memory) => m.source === 'coach' && <span className="ml-1.5 text-[11px] text-faint">· coach</span>;

/** Soonest first, so what's about to go is at the top. */
const byDate = (a: Memory, b: Memory) => (a.until ?? '').localeCompare(b.until ?? '');

function NoteEditor({ note, today, onDone }: { note: Memory; today: IsoDate; onDone: () => void }) {
  const { updateMemory } = useProfileMutations();
  const [text, setText] = useState(note.text);
  const [until, setUntil] = useState(note.until ?? '');
  const short = isShortTerm(note);
  const save = (patch: Parameters<typeof updateMemory.mutate>[0]) => updateMemory.mutate(patch, { onSuccess: onDone });
  return (
    <div className="flex flex-col gap-2 border-b border-divider py-2">
      <input autoFocus aria-label="Note" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} className={INPUT} />
      <div className="flex flex-wrap items-center gap-2">
        {short && (
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            Until
            <input type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} className={INPUT} />
          </label>
        )}
        <Button size="sm" variant="primary" disabled={!text.trim() || (short && !until) || updateMemory.isPending} onClick={() => save({ id: note.id, text: text.trim(), ...(short ? { until } : {}) })}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {short && (
          <Button size="sm" variant="ghost" disabled={!text.trim() || updateMemory.isPending} onClick={() => save({ id: note.id, text: text.trim(), unset: ['until'] })}>
            Keep long term
          </Button>
        )}
      </div>
      {updateMemory.error && <ErrorNote>{errorMessage(updateMemory.error)}</ErrorNote>}
    </div>
  );
}

function NoteRow({ note, today }: { note: Memory; today: IsoDate }) {
  const { deleteMemory, reviewMemory } = useProfileMutations();
  const [editing, setEditing] = useState(false);
  if (editing) return <NoteEditor note={note} today={today} onDone={() => setEditing(false)} />;
  const due = needsReview(note, today);
  return (
    <div className="flex items-center gap-2.5 border-b border-divider py-2">
      <div className="flex min-w-0 flex-auto flex-col gap-1">
        <span className="text-[13px]">
          {note.text}
          {sourceLabel(note)}
        </span>
        {note.until && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            Until {formatLongDay(note.until)}
            {today >= note.until && <Tag>Ending</Tag>}
          </span>
        )}
        {due && (
          <span className="flex items-center gap-2">
            <span className={AMBER_TAG}>Still true?</span>
            <button
              type="button"
              disabled={reviewMemory.isPending}
              onClick={() => reviewMemory.mutate(note.id)}
              className="border-0 bg-transparent p-0 text-xs font-semibold text-accent-ink"
            >
              Keep
            </button>
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Edit note"
        onClick={() => setEditing(true)}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted"
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        aria-label="Delete note"
        onClick={() => deleteMemory.mutate(note.id)}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function AddNote({ today, short, onDone }: { today: IsoDate; short: boolean; onDone: () => void }) {
  const { createMemory } = useProfileMutations();
  const [text, setText] = useState('');
  const [until, setUntil] = useState(addDays(today, 7));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input autoFocus aria-label="New note" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} className={`${INPUT} min-w-0 flex-[1_1_180px]`} />
        {short && <input type="date" aria-label="Until" value={until} min={today} onChange={(e) => setUntil(e.target.value)} className={INPUT} />}
        <Button
          size="sm"
          variant="primary"
          disabled={!text.trim() || (short && !until) || createMemory.isPending}
          onClick={() => createMemory.mutate({ text: text.trim(), ...(short ? { until } : {}) }, { onSuccess: onDone })}
        >
          Save
        </Button>
      </div>
      {createMemory.error && <ErrorNote>{errorMessage(createMemory.error)}</ErrorNote>}
    </div>
  );
}

function NoteCard({
  title,
  about,
  badge,
  short,
  notes,
  empty,
  today,
}: {
  title: string;
  about: string;
  badge?: string | undefined;
  short: boolean;
  notes: Memory[];
  empty: string;
  today: IsoDate;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Card className="flex flex-col gap-2.5 p-[18px]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-base">
            {title}
            {badge && <span className={AMBER_TAG}>{badge}</span>}
          </h2>
          <div className="text-xs text-muted">{about}</div>
        </div>
        <Button size="sm" variant="ghost" className="flex-none" onClick={() => setAdding((a) => !a)}>
          + Add
        </Button>
      </div>
      {adding && <AddNote today={today} short={short} onDone={() => setAdding(false)} />}
      {notes.length === 0 && !adding && <div className="text-[13px] text-muted">{empty}</div>}
      {notes.map((m) => (
        <NoteRow key={m.id} note={m} today={today} />
      ))}
    </Card>
  );
}

/** Coach memory, in its two buckets (DECISIONS #79). */
export function MemorySection({ memories, today }: { memories: Memory[]; today: IsoDate }) {
  const longTerm = memories.filter((m) => !isShortTerm(m));
  const toReview = longTerm.filter((m) => needsReview(m, today)).length;
  return (
    <>
      <NoteCard
        title="Short-term memory"
        about="What the coach keeps in mind for now. Each note is forgotten the day after its date."
        short
        notes={memories.filter(isShortTerm).sort(byDate)}
        empty="Nothing right now. Tell the coach in chat, like “I’m away next Wednesday”, and it will show up here."
        today={today}
      />
      <NoteCard
        title="Long-term memory"
        about="Always sent to the coach, so keep these up to date. It asks you to check any note that’s gone six months without a look."
        badge={toReview > 0 ? `${toReview} to review` : undefined}
        short={false}
        notes={longTerm}
        empty="Nothing yet. Add what the coach should always know, like when you can ride or what you’re working around."
        today={today}
      />
    </>
  );
}
