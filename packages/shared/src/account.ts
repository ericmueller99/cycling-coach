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
