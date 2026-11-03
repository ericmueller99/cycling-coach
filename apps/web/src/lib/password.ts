import { MIN_PASSWORD_LENGTH } from '@cycling-coach/shared';

/**
 * The register and reset pages' 3-segment meter (DECISIONS #61): 1 = too short, 2 = long enough,
 * 3 = long, or mixed case with a digit or symbol. A hint; the server's only rule is the length.
 */
export function passwordMeter(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  if (pw.length < MIN_PASSWORD_LENGTH) return 1;
  const mixed = /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[^A-Za-z]/.test(pw);
  return pw.length >= 14 || mixed ? 3 : 2;
}
