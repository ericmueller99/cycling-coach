import { CheckIcon } from '../../components/icons';

/** Above the form after a photo was read: the photo, and what needs a look. */
export function ReadBanner({ previews, read, check, note }: { previews: string[]; read: number; check: number; note?: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-[#ABEFC6] bg-[#ECFDF3] p-3 text-[13px] text-[#085D3A]">
      {previews.map((p) => (
        <img key={p} src={p} alt="Your photo" className="h-20 w-auto max-w-[120px] flex-none rounded-lg border border-line bg-white object-contain" />
      ))}
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 font-semibold">
          <CheckIcon /> Read {read} value{read === 1 ? '' : 's'} from your photo.
        </span>
        {check > 0 && <span>{check} need a quick check (highlighted).</span>}
        {note && <span className="text-[#3C6E57]">{note}</span>}
        <span className="text-[#3C6E57]">Save it once — next time it's a search or barcode scan, no AI.</span>
      </div>
    </div>
  );
}
