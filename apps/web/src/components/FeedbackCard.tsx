import { isRating, rpeWord } from '@cycling-coach/core';
import type { SessionFeedback } from '@cycling-coach/shared';
import { useId, useState } from 'react';
import { rpeStyle } from '../lib/feedback';
import { errorMessage, useSaveFeedback } from '../lib/queries';
import { Button, ErrorNote } from './ui';

const SCALE = Array.from({ length: 10 }, (_, i) => i + 1);

/**
 * "How did it feel?": RPE 1–10 and an optional note in the athlete's own words. Optional and
 * stored only — the coach reads it with the ride data when it pulls rides; nothing is sent now.
 */
export function FeedbackCard({ target, feedback: stored }: { target: { eventId: string } | { activityId: string }; feedback: SessionFeedback | undefined }) {
  const save = useSaveFeedback();
  // What was just saved shows straight away; the calendar's copy takes over once it's as new.
  const saved = save.data && 'rpe' in save.data ? save.data : undefined;
  const latest = saved && (!stored || stored.updatedAt < saved.updatedAt) ? saved : stored;
  // A reason from when the session was missed isn't a rating: the form opens empty (DECISIONS #97).
  const feedback = latest && isRating(latest) ? latest : undefined;
  const noteId = useId();
  const [editing, setEditing] = useState(!feedback);
  const [rpe, setRpe] = useState<number | null>(feedback?.rpe ?? null);
  const [note, setNote] = useState(feedback?.note ?? '');
  const label = rpe ? `${rpe} · ${rpeWord(rpe)}` : 'Pick 1–10';

  const submit = () => {
    if (rpe === null) return;
    save.mutate({ ...target, rpe, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: () => setEditing(false) });
  };
  const edit = () => {
    setRpe(feedback?.rpe ?? null);
    setNote(feedback?.note ?? '');
    setEditing(true);
  };

  return (
    <section aria-label="How did it feel?" className="flex flex-col gap-3.5 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[15px]">How did it feel?</h3>
        {!editing && feedback && (
          <Button size="sm" onClick={edit}>
            Edit
          </Button>
        )}
      </div>

      {editing || !feedback ? (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-muted">Difficulty (RPE)</span>
              <span style={{ color: rpe ? rpeStyle(rpe).fg : undefined }} className={rpe ? '' : 'text-muted'}>
                {label}
              </span>
            </div>
            <div role="radiogroup" aria-label="Difficulty from 1 to 10" className="grid grid-cols-10 gap-[3px]">
              {SCALE.map((v) => {
                const on = rpe === v;
                const fg = rpeStyle(v).fg;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`${v} — ${rpeWord(v)}`}
                    onClick={() => setRpe(v)}
                    className="min-h-[44px] min-w-0 rounded-lg p-0 font-mono text-sm font-semibold"
                    style={{ border: `1px solid ${on ? fg : '#D5D9E0'}`, background: on ? fg : '#FFFFFF', color: on ? '#FFFFFF' : '#15181E' }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between text-[11px] text-muted">
              <span>Very easy</span>
              <span>Moderate</span>
              <span>Max</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={noteId} className="text-xs font-semibold text-muted">
              How it went <span className="font-normal">· optional, in your own words</span>
            </label>
            <textarea
              id={noteId}
              rows={4}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. First 2 intervals felt easy, 3 was medium, last 2 were hard. Slept badly."
              className="resize-y rounded-[10px] border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink"
            />
            <span className="text-[11px] text-muted">Sent to the coach with the ride data.</span>
          </div>

          <div className="flex gap-2">
            {feedback && (
              <Button size="lg" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button size="lg" variant={rpe === null ? 'neutral' : 'primary'} className="flex-1" disabled={rpe === null || save.isPending} onClick={submit}>
              {save.isPending ? 'Saving…' : 'Save feedback'}
            </Button>
          </div>
          {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[22px] font-semibold" style={{ color: rpeStyle(feedback.rpe).fg }}>
              {feedback.rpe}/10
            </span>
            <span className="font-semibold">{rpeWord(feedback.rpe)}</span>
          </div>
          {feedback.note && <div className="rounded-lg bg-surface-2 px-2.5 py-2 text-[13px] whitespace-pre-wrap text-[#4B5563]">“{feedback.note}”</div>}
        </div>
      )}
    </section>
  );
}
