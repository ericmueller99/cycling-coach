import { isShortTerm, needsReview } from '@cycling-coach/core';
import type { IsoDate, Memory } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { CheckIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { useExtensions } from '../../extensions';
import { useProfile } from '../../lib/queries';
import { MemorySection } from '../athlete/memory';

const NO_NOTES: Memory[] = [];

/** The coach's notes in their two buckets, for the Memory button, the rail and the panel. */
export function useMemoryNotes(today: IsoDate) {
  const notes = useProfile().data?.memories ?? NO_NOTES;
  const longTerm = notes.filter((m) => !isShortTerm(m));
  return { notes, longTerm, toReview: longTerm.filter((m) => needsReview(m, today)).length };
}

/**
 * Coach memory from the chat (DECISIONS #85): the same notes as Athlete › Goals & coach. Every change
 * here goes straight to the memory routes and never through the coach, so it costs nothing.
 */
export function MemoryPanel({ today, onClose }: { today: IsoDate; onClose: () => void }) {
  const { coachCopy } = useExtensions();
  const { notes } = useMemoryNotes(today);
  return (
    <Sheet
      title="Coach memory"
      onClose={onClose}
      panel
      header={
        <div className="mt-3 -mr-10 flex items-start gap-2.5 rounded-[10px] bg-accent-tint-2 px-3 py-2.5 text-[13px] text-[#2B3A0A]">
          <CheckIcon size={16} className="mt-0.5 flex-none" />
          <span>{coachCopy.memoryNote}</span>
        </div>
      }
      footer={
        <div className="text-[13px] text-muted">
          Also in{' '}
          <Link to="/athlete/$tab" params={{ tab: 'goals' }} onClick={onClose} className="font-semibold">
            Athlete › Goals &amp; coach
          </Link>
        </div>
      }
    >
      <div className="flex flex-col gap-7">
        <MemorySection memories={notes} today={today} plain />
      </div>
    </Sheet>
  );
}
