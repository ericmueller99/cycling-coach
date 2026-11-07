import type { FoodLogEntry } from '@cycling-coach/shared';
import { useEntryPhotos } from '../../lib/foodQueries';

/** The first photo of an estimate, for its row in the day. Nothing when photos weren't kept. */
export function EntryThumb({ entry }: { entry: FoodLogEntry }) {
  const has = !!entry.estimate?.images.length;
  const url = useEntryPhotos(entry.id, has).data?.[0]?.url;
  if (!has) return null;
  return url ? <img src={url} alt="" className="h-10 w-10 flex-none rounded-lg border border-line object-cover" /> : <span aria-hidden="true" className="h-10 w-10 flex-none rounded-lg bg-surface-2" />;
}

/** An estimate's photos, full size, with what each one is of. */
export function EntryPhotoList({ entry }: { entry: FoodLogEntry }) {
  const photos = useEntryPhotos(entry.id, true);
  if (photos.isPending) return <div className="text-[13px] text-muted">Loading photos…</div>;
  if (!photos.data?.length) return <div className="text-[13px] text-muted">These photos aren’t available.</div>;
  return (
    <div className="flex flex-wrap gap-3">
      {photos.data.map((p) => (
        <figure key={p.url} className="m-0">
          <img src={p.url} alt={`The ${p.kind}`} className="h-44 w-auto max-w-full rounded-[10px] border border-line object-contain" />
          <figcaption className="mt-1 text-xs text-muted capitalize">{p.kind}</figcaption>
        </figure>
      ))}
    </div>
  );
}
