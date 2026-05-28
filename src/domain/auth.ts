/**
 * Auth domain (F2) — pure values and the login-hash composition.
 *
 * The Supernote login password field is `sha256(md5(password) + randomCode)` in
 * lowercase hex (Interfaces, F2-FR3). MD5 is a bundled pure function; the SHA-256
 * digest primitive is INJECTED (WebCrypto lives in an adapter) so this module
 * stays pure and unit-testable against a known vector (ADR-0003).
 *
 * The password is a transient input here and is never returned, stored, or
 * logged (I-1 / D-2 / F2-FR2).
 */
import { md5hex } from '@shared/md5';

/** A SHA-256 digest function returning lowercase hex (injected; WebCrypto adapter). */
export type Sha256Hex = (input: string) => Promise<string>;

/**
 * Phone country code sent on the nonce and login calls. Reference clients
 * hardcode "1" (US); a different value is only collected if the F5-FR1 spike
 * shows "1" fails for the target account (R-7). Default is "1".
 */
export type CountryCode = string;

export const DEFAULT_COUNTRY_CODE: CountryCode = '1';

/** A persisted access token (public Cloud) or JWT (Private Cloud). */
export type Token = string;

/**
 * Compute the Supernote login password hash: lowercase hex
 * `sha256(md5(password) + randomCode)`. The `password` argument is used only to
 * derive the hash and is never retained by this function (F2-FR2).
 */
export async function loginHash(
  password: string,
  randomCode: string,
  sha256hex: Sha256Hex,
): Promise<string> {
  const inner = md5hex(password);
  return sha256hex(inner + randomCode);
}

/** Connection state shown in the popup and reflected on the toolbar badge (F2-FR6). */
export type SessionState = 'connected' | 'expired' | 'disconnected';

/** Toolbar badge state, mirrored from ports to keep the mapping in the domain. */
export type BadgeState = 'idle' | 'busy' | 'error' | 'expired';

/**
 * Map a session state (and whether a send job is in flight) to a badge state
 * (F2-FR6 / F6-FR5). A busy job takes precedence over the idle/connected badge;
 * an expired session always shows the expired badge.
 */
export function badgeStateFor(session: SessionState, jobInFlight = false): BadgeState {
  if (session === 'expired') {
    return 'expired';
  }
  if (jobInFlight) {
    return 'busy';
  }
  if (session === 'disconnected') {
    return 'error';
  }
  return 'idle';
}
