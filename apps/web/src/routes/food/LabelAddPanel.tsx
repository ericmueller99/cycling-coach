import type { Food, Portion } from '@cycling-coach/shared';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, ErrorNote } from '../../components/ui';
import { useFoodMutations } from '../../lib/foodQueries';
import { errorMessage } from '../../lib/queries';
import { DraftPreview, draftFromReading, draftToInput, FoodForm, type FoodDraft } from './FoodForm';
import { PhotoTiles, usePhotoCapture } from './PhotoDialog';
import { ReadBanner } from './ReadBanner';

interface Review {
  draft: FoodDraft;
  flags: Set<string>;
  read: number;
  note: string;
  previews: string[];
}

const HINT = "Photo of the nutrition facts — add the front of the pack as a 2nd photo for the name. Read once by a small model; you check it before it's saved.";

/** Photos → one small-model read → the usual food form to check → an explicit save (`add` as the caller asks). */
function useLabelAdd({ nameHint, onSaved }: { nameHint: string; onSaved: (food: Food, portion: Portion, add: boolean) => void }) {
  const m = useFoodMutations();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capture = usePhotoCapture({
    onRead: ({ reading, images, previews }) => {
      const { draft, flags, read } = draftFromReading(reading, reading.imageType, images);
      setReview({ draft: { ...draft, name: draft.name.trim() || nameHint.trim() }, flags, read, note: reading.note, previews });
    },
  });

  // The previews live as long as this flow; drop them when it goes away.
  const held = useRef<string[]>([]);
  held.current = review?.previews ?? capture.photos.map((p) => p.preview);
  useEffect(() => () => held.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const save = (add: boolean) => {
    if (!review) return;
    const parsed = draftToInput(review.draft);
    if ('error' in parsed) return setError(parsed.error);
    setError(null);
    m.createFood.mutate(parsed.input, { onSuccess: (food) => onSaved(food, food.defaultPortion, add), onError: (e) => setError(errorMessage(e)) });
  };

  const reviewBody = review && (
    <>
      <ReadBanner previews={review.previews} read={review.read} check={[...review.flags].filter((f) => f !== 'barcode').length} note={review.note} />
      <FoodForm draft={review.draft} onChange={(draft) => setReview({ ...review, draft })} flags={review.flags} />
    </>
  );
  return { capture, review, reviewBody, error, save, busy: m.createFood.isPending };
}

/** The label read inline, on the food intro: there's nothing else on that page to tap, and nothing to add it to. */
export function LabelAddPanel({ onSaved }: { onSaved: (food: Food) => void }) {
  const { capture, review, reviewBody, error, save, busy } = useLabelAdd({ nameHint: '', onSaved: (food) => onSaved(food) });
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface-alt p-3">
      <span className="text-[13px] font-semibold">{review ? 'Check and save' : 'Read a nutrition label'}</span>
      {review ? (
        <>
          {reviewBody}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            <DraftPreview draft={review.draft} />
            <span className="grow" />
            <Button variant="primary" disabled={busy} onClick={() => save(false)}>
              Save to my foods
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-muted">{HINT}</div>
          <PhotoTiles capture={capture} compact />
          <div className="flex justify-end">
            <Button variant="primary" disabled={!capture.canRead} onClick={capture.read}>
              {capture.reading ? 'Reading…' : 'Read it'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A nutrition label read from the recipe / meal builder, over it (DECISIONS #109): while it's open its own
 * actions are the only ones, and Cancel or a save lands back on the builder. Both saves create the food (an
 * ingredient or meal item always points at one of the user's foods); only one also adds it.
 */
export function LabelAddDialog({
  target,
  nameHint = '',
  onSaved,
  onClose,
}: {
  target: 'recipe' | 'meal';
  /** The search text — the name when the label doesn't show one. */
  nameHint?: string;
  onSaved: (food: Food, portion: Portion, add: boolean) => void;
  onClose: () => void;
}) {
  const { capture, review, reviewBody, error, save, busy } = useLabelAdd({ nameHint, onSaved });
  const cancel = (
    <Button variant="ghost" onClick={onClose}>
      Cancel
    </Button>
  );
  return (
    <Dialog
      title={review ? 'Check and save' : 'Read a nutrition label'}
      width={640}
      tall={!!review}
      panel
      onClose={onClose}
      footer={
        review ? (
          <div className="flex flex-col gap-2">
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="flex flex-wrap items-center gap-2">
              <DraftPreview draft={review.draft} />
              <span className="grow" />
              {cancel}
              <Button disabled={busy} onClick={() => save(false)}>
                Save to my foods only
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => save(true)}>
                Save to my foods &amp; add to {target}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {cancel}
            <span className="grow" />
            <Button variant="primary" disabled={!capture.canRead} onClick={capture.read}>
              {capture.reading ? 'Reading…' : 'Read it'}
            </Button>
          </div>
        )
      }
    >
      {review ? (
        reviewBody
      ) : (
        <>
          <div className="text-[13px] text-muted">{HINT}</div>
          <PhotoTiles capture={capture} />
        </>
      )}
    </Dialog>
  );
}
