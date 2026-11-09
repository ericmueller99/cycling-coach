import { formatLongDay, todayIn } from '@cycling-coach/core';
import { OUTLOOK_MAX } from '@cycling-coach/shared';
import { useState } from 'react';
import { LogoIcon } from '../../components/icons';
import { Button, Card, ErrorNote } from '../../components/ui';
import { errorMessage, useOutlook, useOutlookMutations } from '../../lib/queries';

/**
 * The coach's outlook (DECISIONS #101): how it's balancing the athlete's goals and events right now, in
 * its words. The athlete can edit or clear it here without asking the coach, so it costs no AI.
 */
export function OutlookCard({ timezone }: { timezone: string }) {
  const outlook = useOutlook();
  const { save, clear } = useOutlookMutations();
  const [draft, setDraft] = useState<string | null>(null);
  const o = outlook.data;
  const error = save.error ?? clear.error ?? outlook.error;
  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <LogoIcon size={16} className="text-accent-ink" />
          <h2 className="m-0 text-base">Coach’s outlook</h2>
        </div>
        <div className="text-xs text-muted">How your coach is balancing your goals and events right now. It updates this as things change. It’s never a schedule.</div>
      </div>
      {draft !== null ? (
        <>
          <label htmlFor="outlook-text" className="sr-only">
            Coach’s outlook
          </label>
          <textarea
            id="outlook-text"
            rows={7}
            value={draft}
            maxLength={OUTLOOK_MAX}
            onChange={(e) => setDraft(e.target.value)}
            className="rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!draft.trim() || save.isPending} onClick={() => save.mutate(draft.trim(), { onSuccess: () => setDraft(null) })}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      ) : o ? (
        <>
          <p className="m-0 text-[13px] leading-relaxed whitespace-pre-wrap">{o.text}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="flex-auto">
              Updated {formatLongDay(todayIn(timezone, new Date(o.updatedAt)))} by {o.source === 'coach' ? 'your coach' : 'you'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setDraft(o.text)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>
              Clear
            </Button>
          </div>
        </>
      ) : (
        !outlook.isPending && <p className="m-0 text-[13px] text-muted">Nothing yet. Your coach writes this when it plans around your goals and events.</p>
      )}
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
    </Card>
  );
}
