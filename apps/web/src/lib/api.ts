import type { AppType } from '@cycling-coach/api/app';
import { hc, type ClientResponse } from 'hono/client';

/**
 * Typed API client. `AppType` is the Hono router's own type, so paths and response shapes are
 * checked at compile time with no generated client.
 *
 * Web: same origin (Vite proxies /api in dev; the API serves the SPA in production), cookie
 * session. Native (Phase 5): VITE_API_URL plus a bearer token.
 */
export const apiBaseUrl: string = import.meta.env['VITE_API_URL'] || window.location.origin;

export const api = hc<AppType>(apiBaseUrl, { init: { credentials: 'include' } });

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Better Auth's error code, e.g. `INVALID_PASSWORD`. */
    public readonly code?: string,
    /** Where to go about it, on a 402. */
    public readonly action?: { label: string; href: string },
  ) {
    super(message);
  }
}

/** Statuses our routes return explicitly for failures. Plain `c.json(data)` is the success branch. */
type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 410 | 413 | 429 | 500 | 502 | 503;

/** The success body out of a route's response union. */
type Ok<R> = R extends ClientResponse<infer T, infer S, infer _F> ? (S extends ErrorStatus ? never : T) : never;

/** Unwrap a typed RPC response, throwing on failure with the server's error message. */
export async function unwrap<R extends ClientResponse<unknown, number, string>>(res: R): Promise<Ok<R>> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let action: ApiError['action'];
    try {
      const body = (await res.json()) as { error?: string; message?: string; action?: ApiError['action'] };
      message = body.error ?? body.message ?? message;
      action = body.action;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, undefined, action);
  }
  return (await res.json()) as Ok<R>;
}

/** Better Auth endpoints aren't part of the typed router; plain fetch is enough. */
async function authPost(path: string, body: object, fallback: string) {
  const res = await fetch(`${apiBaseUrl}/api/auth/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new ApiError(res.status, err.message ?? fallback, err.code);
  }
}

/** `rememberMe: false` ends the session when the browser closes. */
export async function signIn(email: string, password: string, rememberMe = true) {
  await authPost('sign-in/email', { email, password, rememberMe }, 'Sign-in failed');
}

/**
 * Creates the account and signs it in (DECISIONS #61). Where the server verifies email, the link in
 * that email comes back to `callbackURL`. An address already in use → ApiError `USER_ALREADY_EXISTS`.
 */
export async function signUp(body: { name: string; email: string; password: string }) {
  await authPost('sign-up/email', { ...body, callbackURL: `${window.location.origin}/welcome` }, 'Could not create your account');
}

/** Emails a reset link if the account exists. The answer is the same either way. */
export async function requestPasswordReset(email: string) {
  await authPost('request-password-reset', { email, redirectTo: `${window.location.origin}/reset` }, 'Could not send the reset email');
}

/** With the token from the emailed link. An expired or used token → ApiError `INVALID_TOKEN`. */
export async function resetPassword(token: string, newPassword: string) {
  await authPost('reset-password', { token, newPassword }, 'Could not reset your password');
}

/** Sends the confirm-your-email link again. */
export async function sendVerificationEmail(email: string) {
  await authPost('send-verification-email', { email, callbackURL: `${window.location.origin}/` }, 'Could not send the email');
}

export async function signOut() {
  await authPost('sign-out', {}, 'Sign-out failed');
}

export async function updateName(name: string) {
  await authPost('update-user', { name }, 'Could not save your name');
}

/** Wrong current password → ApiError with code `INVALID_PASSWORD`. */
export async function changePassword(body: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean }) {
  await authPost('change-password', body, 'Could not change your password');
}

/** Download a .zwo via the authenticated API and hand it to the browser as a file. */
export async function downloadZwo(workoutId: string) {
  const res = await fetch(`${apiBaseUrl}/api/workouts/${workoutId}/zwo`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'workout.zwo';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
