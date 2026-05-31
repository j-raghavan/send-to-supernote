/**
 * CaptureCloudToken use case (Supernote-Cloud connect) — public Cloud sign-in is
 * CAPTCHA/2FA-gated on Supernote's own page, so the extension does NOT log in.
 * Instead the user signs in on `cloud.supernote.com`, and this reads the
 * `x-access-token` session cookie that page sets and persists it as the public
 * Cloud token (the SAME token the upload API accepts as `x-access-token` on
 * `viewer.supernote.com` — verified live 2026-05-28). The cookie never leaves
 * the device (D-3); only the token is stored (D-2).
 *
 * Robustness (cross-browser): the cookie is read by DOMAIN (`supernote.com`),
 * not a single pinned URL, so it is found whether Supernote set it on `cloud.`
 * or `viewer.supernote.com`; and the caller may pass the cookie STORE ids to
 * search, so connect works from an Incognito window (Chrome) or a container /
 * private window (Firefox) — the cookie there lives in a non-default store. When
 * several candidate cookies exist (multiple hosts/stores), the freshest valid
 * one wins.
 */
import type { CookieReader } from '@shared/ports';
import { err, ok, type Result } from '@shared/result';
import { type AccessTokenClaims, decodeAccessToken } from '@domain/auth';
import type { TokenStore } from './token-store';

/** Origin whose login sets the session cookie (also the tab the connect opens). */
export const CLOUD_WEB_URL = 'https://cloud.supernote.com';
/** Registrable domain the session cookie lives under (`cloud.`/`viewer.` are subdomains). */
export const SUPERNOTE_COOKIE_DOMAIN = 'supernote.com';
/** Session cookie name the official login page sets on success. */
export const ACCESS_TOKEN_COOKIE = 'x-access-token';

/**
 * True when a cookie's `domain` belongs to Supernote — exactly `supernote.com`
 * or a subdomain of it — ignoring a leading dot (`.supernote.com`). Used to gate
 * the `cookies.onChanged` trigger so a lookalike host like `evil-supernote.com`
 * does NOT wake the connect flow. (A loose `includes('supernote.com')` would.)
 */
export function isSupernoteCookieDomain(domain: string): boolean {
  const d = domain.replace(/^\./, '');
  return d === SUPERNOTE_COOKIE_DOMAIN || d.endsWith(`.${SUPERNOTE_COOKIE_DOMAIN}`);
}

/**
 * Decide which cookie stores to search when finalizing a pending connect for
 * `tabId`. Prefer the store recorded when the login tab opened (Firefox reports
 * `cookieStoreId` directly), else resolve it from the tab now (Chrome). When the
 * store is known, search it plus the default store; when it cannot be resolved
 * (e.g. a Chrome `getAllCookieStores` race right after `tabs.create`), fall back
 * to scanning EVERY readable store so capture still succeeds — just more broadly.
 */
export async function resolveConnectStoreIds(
  cookies: Pick<CookieReader, 'storeIdForTab' | 'listStoreIds'>,
  tabId: number,
  recordedStoreId?: string,
): Promise<(string | undefined)[]> {
  const storeId = recordedStoreId ?? (await cookies.storeIdForTab(tabId));
  return storeId !== undefined ? [storeId, undefined] : await cookies.listStoreIds();
}

export type CaptureCloudError = 'no-token' | 'expired';

export interface CaptureCloudDeps {
  cookies: CookieReader;
  tokens: TokenStore;
  /** Wall clock (ms, compared against the JWT `exp`); defaults to Date.now. */
  now?: () => number;
  /**
   * Cookie stores to search. Omit (or pass empty) to read only the default
   * store. The connect flow passes the login tab's store (Incognito/container)
   * and/or every readable store so an already-signed-in session is found.
   */
  storeIds?: (string | undefined)[];
}

export interface CaptureCloudResult {
  /** Numeric account id from the token, when present (not the email). */
  userId?: string;
}

interface Candidate {
  token: string;
  claims: AccessTokenClaims | undefined;
}

/** True when the token's JWT `exp` (seconds) is at/after `nowMs`, or it has no `exp`. */
function isLive(claims: AccessTokenClaims | undefined, nowMs: number): boolean {
  return claims?.exp === undefined || claims.exp * 1000 > nowMs;
}

/**
 * Read the official-login session cookie (across the given stores, by domain)
 * and persist the freshest valid one as the public-Cloud token. Returns
 * `no-token` when no session cookie exists anywhere searched, and `expired` when
 * one was found but every candidate is an already-expired JWT (so a stale cookie
 * is never stored).
 */
export async function captureCloudToken(
  deps: CaptureCloudDeps,
): Promise<Result<CaptureCloudResult, CaptureCloudError>> {
  const stores = deps.storeIds && deps.storeIds.length > 0 ? deps.storeIds : [undefined];

  // De-duplicate token values across stores/hosts (the same session cookie can
  // surface once per store searched).
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const storeId of stores) {
    const values = await deps.cookies.getAll({
      domain: SUPERNOTE_COOKIE_DOMAIN,
      name: ACCESS_TOKEN_COOKIE,
      ...(storeId !== undefined ? { storeId } : {}),
    });
    for (const token of values) {
      if (seen.has(token)) continue; // same session cookie seen in another store
      seen.add(token);
      candidates.push({ token, claims: decodeAccessToken(token) });
    }
  }

  if (candidates.length === 0) {
    return err('no-token');
  }

  const nowMs = (deps.now ?? Date.now)();
  const live = candidates.filter((c) => isLive(c.claims, nowMs));
  if (live.length === 0) {
    return err('expired'); // a session cookie exists, but it has already expired
  }

  // Freshest wins: highest `exp` (a token with no `exp` is treated as longest-lived).
  const best = live.reduce((a, b) =>
    (b.claims?.exp ?? Infinity) > (a.claims?.exp ?? Infinity) ? b : a,
  );

  await deps.tokens.save({
    token: best.token,
    equipment: best.claims?.equipmentNo ?? 'WEB',
  });

  return ok(best.claims?.userId !== undefined ? { userId: best.claims.userId } : {});
}
