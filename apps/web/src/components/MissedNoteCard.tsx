import { formatLongDay, isRating } from '@cycling-coach/core';
import type { CalendarEvent, SessionFeedback } from '@cycling-coach/shared';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { errorMessage, useSaveFeedback } from '../lib/queries';
import { useIsMobile } from '../lib/useIsMobile';
import { Button, ErrorNote } from './ui';

/**
 * "What happened?" on a missed or skipped session: a short note in the athlete's own words, no RPE
 * (DECISIONS #97). Stored only. The coach reads it with the calendar and takes it into account when it plans.
 */
export function MissedNoteCard({ eventId, feedback: stored }: { eventId: string; feedback: SessionFeedback | undefined }) {
  const save = useSaveFeedback();
  const fromCalendar = stored && !isRating(stored) && stored.note ? stored : undefined;
  // What this card just saved or cleared shows straight away, until the calendar has something newer.
  const [mine, setMine] = useState<{ note: string | undefined; at: string } | null>(null);
  const note = mine && (!fromCalendar || fromCalendar.updatedAt <= mine.at) ? mine.note : fromCalendar?.note;
  const noteId = useId();
  const [editing, setEditing] = useState(!note);
  const [draft, setDraft] = useState(note ?? '');

  const submit = () =>
    save.mutate(
      { eventId, note: draft.trim() },
      {
        onSuccess: (r) => {
          const removed = 'cleared' in r;
          setMine(removed ? { note: undefined, at: fromCalendar?.updatedAt ?? '' } : { note: (r as SessionFeedback).note, at: (r as SessionFeedback).updatedAt });
          if (removed) setDraft('');
          setEditing(removed);
        },
      },
    );
  const canSave = !!draft.trim() || !!note;

  return (
    <section aria-label="What happened?" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[15px]">What happened?</h3>
        {!editing && note && (
          <Button
            size="sm"
            onClick={() => {
              setDraft(note);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>

      {editing || !note ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={noteId} className="text-xs font-semibold text-muted">
              Why it didn’t happen <span className="font-normal">· optional, in your own words</span>
            </label>
            <textarea
              id={noteId}
              rows={3}
              maxLength={1000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Sick with a cold. Too busy at work. Power was out."
              className="resize-y rounded-[10px] border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink"
            />
            <span className="text-[11px] text-muted">Your coach sees this when it plans.</span>
          </div>
          <div className="flex gap-2">
            {note && (
              <Button size="lg" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button size="lg" variant={canSave ? 'primary' : 'neutral'} className="flex-1" disabled={!canSave || save.isPending} onClick={submit}>
              {save.isPending ? 'Saving…' : note && !draft.trim() ? 'Remove note' : 'Save note'}
            </Button>
          </div>
          {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
        </div>
      ) : (
        <div className="rounded-lg bg-surface-2 px-2.5 py-2 text-[13px] whitespace-pre-wrap text-[#4B5563]">“{note}”</div>
      )}
    </section>
  );
}

/** What "Ask coach to adjust" opens a chat with: the session, its day and its id. */
export const adjustPrompt = (e: Pick<CalendarEvent, 'id' | 'title' | 'date' | 'status'>) =>
  `I ${e.status === 'skipped' ? 'skipped' : 'missed'} ${e.title} on ${formatLongDay(e.date)} (event ${e.id}). Can you adjust my plan around it?`;

/**
 * Under "What happened?": ask the coach to rework the block around a session that didn't happen
 * (DECISIONS #101). A new chat with the message filled in; nothing is sent until the athlete sends it.
 */
export function AskToAdjust({ event }: { event: Pick<CalendarEvent, 'id' | 'title' | 'date' | 'status'> }) {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const prompt = adjustPrompt(event);
  return (
    <div className="flex flex-col items-start gap-0.5">
      <button type="button" onClick={() => void navigate({ to: '/', search: { new: true, prompt } })} className="min-h-10 border-0 bg-transparent p-0 text-sm font-semibold text-accent-ink">
        Ask coach to adjust my plan
      </button>
      <span className="text-xs text-muted">{mobile ? 'Opens a new chat with the message filled in.' : `Opens a new chat with: “${prompt}”`}</span>
    </div>
  );
}
