/**
 * CaptureCloudToken use case (Supernote-Cloud connect) — public Cloud sign-in is
 * CAPTCHA/2FA-gated on Supernote's own page, so the extension does NOT log in.
 * Instead the user signs in on `cloud.supernote.com`, and this reads the
 * `x-access-token` session cookie that page sets and persists it as the public
 * Cloud token (the SAME token the upload API accepts as `x-access-token` on
 * `viewer.supernote.com` — verified live 2026-05-28). The cookie never leaves
 * the device (D-3); only the token is stored (D-2).
 */
import type { CookieReader } from '@shared/ports';
import { err, ok, type Result } from '@shared/result';
import { decodeAccessToken } from '@domain/auth';
import type { TokenStore } from './token-store';

/** Origin whose login sets the session cookie. */
export const CLOUD_WEB_URL = 'https://cloud.supernote.com';
/** Session cookie name the official login page sets on success. */
export const ACCESS_TOKEN_COOKIE = 'x-access-token';

export type CaptureCloudError = 'no-token' | 'expired';

export interface CaptureCloudDeps {
  cookies: CookieReader;
  tokens: TokenStore;
  /** Wall clock (seconds compared against the JWT `exp`); defaults to Date.now. */
  now?: () => number;
}

export interface CaptureCloudResult {
  /** Numeric account id from the token, when present (not the email). */
  userId?: string;
}

/**
 * Read the official-login session cookie and persist it as the public-Cloud
 * token. Returns `no-token` when the user has not signed in yet, and `expired`
 * when the cookie holds an already-expired JWT (so a stale cookie is not stored).
 */
export async function captureCloudToken(
  deps: CaptureCloudDeps,
): Promise<Result<CaptureCloudResult, CaptureCloudError>> {
  const token = await deps.cookies.get(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE);
  if (token === undefined || token.length === 0) {
    return err('no-token');
  }

  const claims = decodeAccessToken(token);
  const nowMs = (deps.now ?? Date.now)();
  if (claims?.exp !== undefined && claims.exp * 1000 <= nowMs) {
    return err('expired');
  }

  await deps.tokens.save({
    token,
    equipment: claims?.equipmentNo ?? 'WEB',
  });

  return ok(claims?.userId !== undefined ? { userId: claims.userId } : {});
}
