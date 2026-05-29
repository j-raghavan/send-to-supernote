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
 * Equipment (client device) id sent on login. The reverse-engineered reference
 * client (bwhitman/supernote-cloud-python) sends the constant `"1"`, which the
 * server records as a recognized device. A per-login random value breaks two
 * ways: the server cannot deserialize a UUID (HTTP 200 `success:false` +
 * `errorCode:"422"` "Request Parameter Serialisation Exception"), and any
 * never-seen value reads as a NEW device, triggering the `E1760` "verify your
 * identity" challenge. A stable constant avoids both — it is a fixed label, not
 * a unique or identifying id.
 */
export const DEFAULT_EQUIPMENT = '1';

/** Claims we read from the Supernote `x-access-token` JWT (others ignored). */
export interface AccessTokenClaims {
  /** Expiry, in seconds since the epoch. */
  exp?: number;
  /** Numeric account id (not the email). */
  userId?: string;
  /** Issuing device label (e.g. "WEB"). */
  equipmentNo?: string;
}

/**
 * Decode (NOT verify) the payload of a Supernote `x-access-token` JWT. Used only
 * to read non-sensitive claims (`exp`, `userId`) so the connect flow can reject
 * an already-expired token; the signature is the server's concern. Returns
 * undefined for anything that is not a well-formed JWT payload.
 */
export function decodeAccessToken(token: string): AccessTokenClaims | undefined {
  const segment = token.split('.')[1];
  if (segment === undefined || segment.length === 0) {
    return undefined;
  }
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const claims = parsed as Record<string, unknown>;
    return {
      ...(typeof claims.exp === 'number' ? { exp: claims.exp } : {}),
      ...(typeof claims.userId === 'string' ? { userId: claims.userId } : {}),
      ...(typeof claims.equipmentNo === 'string' ? { equipmentNo: claims.equipmentNo } : {}),
    };
  } catch {
    return undefined;
  }
}

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
