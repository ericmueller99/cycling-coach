/** Better Auth's `minPasswordLength` and the Account page's checklist. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * What this account may use, separate from what it has connected (DECISIONS #54). Returned with
 * `/api/me`. Self-host: the owner account gets everything. Hosted: per-account flags.
 */
export interface Features {
  /**
   * The logged-in Zwift features: zFTP/zMAP/weight sync and "Get more events" (DECISIONS #52).
   * Whether a login is actually set up is the Zwift status (`not_configured` until then).
   * Hand-entered zFTP and Zwift weight never need this.
   */
  zwiftAccount: boolean;
}

/**
 * What this server's sign-in offers (DECISIONS #61), from `GET /api/auth-config` — public, so the
 * sign-in and register pages can ask before anyone is signed in. Self-host: sign-up closed, no email.
 */
export interface AuthConfig {
  /** Anyone may create an account. */
  signUp: boolean;
  /** "Forgot password?" works: the server can email a reset link. */
  passwordReset: boolean;
  /** New accounts are asked to confirm their email address. */
  emailVerification: boolean;
}

/**
 * Where to go after signing in, from a `?next=`: a path on this site, or nothing. Anything that
 * could leave the site (`//host`, `/\host`, `https://…`, control characters) is refused.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== 'string' || !next.startsWith('/') || next.length > 2000) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null;
  return next;
}
