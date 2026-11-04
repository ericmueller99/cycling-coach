import type { FoodImageRef, NutritionReading } from '@cycling-coach/shared';
import { useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { CameraIcon, XIcon } from '../../components/icons';
import { Button, ErrorNote, errorContent } from '../../components/ui';
import { useReadPhoto } from '../../lib/foodQueries';
import { preparePhoto, type PreparedPhoto } from '../../lib/photo';
import { errorMessage } from '../../lib/queries';

export interface PhotoRead {
  reading: NutritionReading;
  images: FoodImageRef[];
  previews: string[];
}

/**
 * Up to two photos and one read by the small model. Object URLs are revoked by whoever ends up
 * holding them (the review form); only a removed photo's is dropped here.
 */
export function usePhotoCapture({ onRead }: { onRead: (r: PhotoRead) => void }) {
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [error, setError] = useState<ReactNode>(null);
  const [preparing, setPreparing] = useState(false);
  const mutation = useReadPhoto();

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setPreparing(true);
    try {
      const next = await Promise.all([...files].slice(0, 2 - photos.length).map(preparePhoto));
      setPhotos([...photos, ...next].slice(0, 2));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPreparing(false);
    }
  };

  const remove = (p: PreparedPhoto) => {
    URL.revokeObjectURL(p.preview);
    setPhotos(photos.filter((x) => x !== p));
  };

  const read = () => {
    setError(null);
    mutation.mutate(
      { images: photos.map((p) => ({ mediaType: p.mediaType, data: p.data })) },
      {
        onSuccess: (r) => {
          if (!r.reading.found) return setError('No calorie information found in that photo. Try a clearer shot of the label, or enter it by hand.');
          onRead({ reading: r.reading, images: r.images, previews: photos.map((p) => p.preview) });
        },
        onError: (e) => setError(errorContent(e)),
      },
    );
  };

  return { photos, add, remove, read, reading: mutation.isPending, preparing, error, canRead: photos.length > 0 && !mutation.isPending && !preparing };
}
export type PhotoCapture = ReturnType<typeof usePhotoCapture>;

/** The photo tiles: previews with remove, Take photo / Choose file, and the read error. */
export function PhotoTiles({ capture, compact = false }: { capture: PhotoCapture; compact?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const { photos, add, remove, preparing, error } = capture;
  const h = compact ? 'h-32' : 'h-44';
  return (
    <>
      <div className="flex flex-wrap gap-3">
        {photos.map((p, i) => (
          <figure key={p.preview} className="relative m-0">
            <img src={p.preview} alt={i === 0 ? 'Your photo' : 'Second photo'} className={`${h} w-auto max-w-[260px] rounded-[10px] border border-line object-contain`} />
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => remove(p)}
              className="absolute top-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full border-0 bg-[rgba(21,24,30,.7)] text-white"
            >
              <XIcon />
            </button>
            <figcaption className="mt-1 text-xs text-muted">
              {i === 0 ? 'Photo' : '2nd photo'} · {Math.round(p.bytes / 1024)} KB
            </figcaption>
          </figure>
        ))}
        {photos.length < 2 && (
          <div className={`flex ${compact ? 'min-h-32' : 'min-h-44'} min-w-[200px] flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-surface-2 p-4`}>
            <CameraIcon size={24} className="text-muted" />
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => cameraRef.current?.click()} disabled={preparing}>
                Take photo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={preparing}>
                Choose file
              </Button>
            </div>
            <span className="text-xs text-muted">{photos.length ? 'Optional: front of pack or barcode' : 'JPEG, PNG or a screenshot'}</span>
          </div>
        )}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void add(e.target.files).finally(() => (e.target.value = ''))} />
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void add(e.target.files).finally(() => (e.target.value = ''))} />
      {error && <ErrorNote>{error}</ErrorNote>}
    </>
  );
}

/**
 * Add a food from a photo: pick or take up to two photos, the small model reads
 * them, and the food form opens with the values for a check. One model call per food — after
 * that it's a search or a barcode scan.
 */
export function PhotoDialog({
  barcode,
  onClose,
  onRead,
}: {
  /** A scanned barcode to attach to the new food. */
  barcode?: string | undefined;
  onClose: () => void;
  onRead: (r: PhotoRead) => void;
}) {
  const capture = usePhotoCapture({ onRead });
  return (
    <Dialog
      title="Add a food from a photo"
      width={640}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Read once by a small model, then saved to your foods — next time it's a search or a scan, no AI.</span>
          <span className="grow" />
          <Button variant="primary" disabled={!capture.canRead} onClick={capture.read}>
            {capture.reading ? 'Reading…' : 'Read it'}
          </Button>
        </div>
      }
    >
      <div className="text-[13px] text-muted">
        A nutrition label, an app screenshot (Starbucks, Tim Hortons), a menu or recipe card — anything with the calories on it. Add the front of the pack as a 2nd photo for the name.
      </div>
      {barcode && <div className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-[13px]">Barcode {barcode} will be saved with it.</div>}
      <PhotoTiles capture={capture} />
    </Dialog>
  );
}
