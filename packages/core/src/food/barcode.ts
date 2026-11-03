/**
 * Barcodes are stored as GTIN-13 where possible, so a UPC-A (12 digits) printed on a US-made pack
 * and the same product scanned as EAN-13 (leading 0) match. EAN-8 stays as is.
 */
export function normalizeBarcode(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 14 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12) d = `0${d}`;
  if (d.length !== 8 && d.length !== 13) return null;
  return d;
}

/** GS1 check digit — catches a misread or mistyped digit. */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function sameBarcode(a: string, b: string): boolean {
  const na = normalizeBarcode(a);
  return na != null && na === normalizeBarcode(b);
}
