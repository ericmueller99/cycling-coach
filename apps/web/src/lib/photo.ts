/**
 * Photos are shrunk in the browser before upload: the model reads a 1600 px JPEG as
 * well as a 12 MP original, and it's ~200 KB instead of 4 MB on a phone connection.
 */
export interface PreparedPhoto {
  mediaType: 'image/jpeg';
  /** Base64, no data: prefix. */
  data: string;
  /** Object URL for the preview. */
  preview: string;
  bytes: number;
}

const MAX_EDGE = 1600;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the photo.'));
    r.readAsDataURL(blob);
  });
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That file isn’t a photo the browser can open.');
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the photo.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', 0.85));
  return { mediaType: 'image/jpeg', data: await blobToBase64(blob), preview: URL.createObjectURL(blob), bytes: blob.size };
}
