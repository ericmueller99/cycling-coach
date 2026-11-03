import { normalizeBarcode } from '@cycling-coach/core';
import { useEffect, useRef, useState } from 'react';
import { Button, ErrorNote, inputCls } from './ui';

/**
 * Live barcode scanning with the camera (EAN-13 / UPC-A / EAN-8 / UPC-E). Safari has no native
 * BarcodeDetector, so the `barcode-detector` ponyfill (zxing-wasm) runs everywhere; its WebAssembly
 * is bundled with the app instead of fetched from a CDN. Typing the digits always works too.
 */
export function BarcodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [live, setLive] = useState(false);
  const done = useRef(false);
  const report = useRef(onCode);
  report.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser can’t use the camera here (it needs HTTPS). Type the digits instead.');
        return;
      }
      const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
        import('barcode-detector/ponyfill'),
        import('zxing-wasm/reader/zxing_reader.wasm?url'),
      ]);
      prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      try {
        // A permission prompt left unanswered (or no camera at all) never settles; don't wait forever.
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false }),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 10_000)),
        ]);
      } catch {
        if (!cancelled) setError('No camera access. Allow the camera, or type the digits below.');
        return;
      }
      if (cancelled || !videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
      setLive(true);
      const tick = async () => {
        if (cancelled || done.current || !videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          const code = found.map((b) => normalizeBarcode(b.rawValue)).find((c): c is string => !!c);
          if (code) {
            done.current = true;
            navigator.vibrate?.(60);
            report.current(code);
            return;
          }
        } catch {
          /* a frame that couldn't be read */
        }
        timer = window.setTimeout(() => void tick(), 200);
      };
      void tick();
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const submitTyped = () => {
    const code = normalizeBarcode(typed);
    if (!code) return setError('That isn’t a barcode — 8, 12 or 13 digits.');
    report.current(code);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-[12px] bg-[#0E1014]" style={{ aspectRatio: '4 / 3' }}>
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {live && <div aria-hidden="true" className="absolute inset-x-[12%] top-1/2 h-[30%] -translate-y-1/2 rounded-lg border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,.35)]" />}
        {!live && !error && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/70">Starting the camera…</div>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitTyped();
        }}
      >
        <input aria-label="Barcode digits" inputMode="numeric" placeholder="Or type the digits" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputCls} flex-auto font-mono`} />
        <Button type="submit" disabled={typed.replace(/\D/g, '').length < 8}>
          Look up
        </Button>
      </form>
    </div>
  );
}
