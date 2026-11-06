import type { Food, Portion } from '@cycling-coach/shared';
import { useEffect, useRef, useState } from 'react';
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

/**
 * A nutrition label read inside the recipe / meal builder or the food intro: photos → one
 * small-model read → the usual food form to check → an explicit save. In a builder there are two
 * saves: both create the food (an ingredient or meal item always points at one of the user's
 * foods), and only one also adds it. With no `target` there's nothing to add it to.
 */
export function LabelAddPanel({
  target,
  nameHint = '',
  onSaved,
  onCancel,
}: {
  target?: 'recipe' | 'meal';
  /** The search text — the name when the label doesn't show one. */
  nameHint?: string;
  onSaved: (food: Food, portion: Portion, add: boolean) => void;
  onCancel?: () => void;
}) {
  const m = useFoodMutations();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capture = usePhotoCapture({
    onRead: ({ reading, images, previews }) => {
      const { draft, flags, read } = draftFromReading(reading, reading.imageType, images);
      setReview({ draft: { ...draft, name: draft.name.trim() || nameHint.trim() }, flags, read, note: reading.note, previews });
    },
  });

  // This card holds the previews once read; drop them when it goes away.
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

  const cancel = onCancel && (
    <button type="button" onClick={onCancel} className="border-0 bg-transparent p-0 text-[13px] font-medium text-accent-ink">
      Cancel
    </button>
  );

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface-alt p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">{review ? 'Check and save' : 'Read a nutrition label'}</span>
        {cancel}
      </div>
      {review ? (
        <>
          <ReadBanner previews={review.previews} read={review.read} check={[...review.flags].filter((f) => f !== 'barcode').length} note={review.note} />
          <FoodForm draft={review.draft} onChange={(draft) => setReview({ ...review, draft })} flags={review.flags} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            <DraftPreview draft={review.draft} />
            <span className="grow" />
            <Button variant={target ? 'secondary' : 'primary'} disabled={m.createFood.isPending} onClick={() => save(false)}>
              {target ? 'Save to my foods only' : 'Save to my foods'}
            </Button>
            {target && (
              <Button variant="primary" disabled={m.createFood.isPending} onClick={() => save(true)}>
                Save to my foods &amp; add to {target}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-muted">Photo of the nutrition facts — add the front of the pack as a 2nd photo for the name. Read once by a small model; you check it before it's saved.</div>
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
