/**
 * Private Cloud base-URL validation + HTTP-over-LAN warning (F7-FR3 / F8-FR1 /
 * F8-FR7 / R-10) — pure, covered.
 *
 * The user configures their own server's base URL (e.g. http://192.168.x.x:8080
 * on a LAN or an HTTPS reverse-proxy host). Validate it is a well-formed http/
 * https origin before use, and decide whether to surface the non-HTTPS warning:
 * over plain HTTP on a LAN, the hashed-password login and the JWT transit
 * unencrypted (the plaintext password is never on the wire — it is hashed — but
 * the hash and token are). Acceptable on a trusted LAN; HTTPS recommended.
 */

export type BaseUrlError = 'empty' | 'malformed' | 'unsupported-protocol';

export interface ValidBaseUrl {
  /** Normalized origin-only base URL (no trailing slash, no path). */
  baseUrl: string;
  /** True when the URL is plain HTTP (drives the R-10 warning). */
  isHttp: boolean;
}

export const HTTP_OVER_LAN_WARNING =
  'This server uses plain HTTP, so your login and session token travel unencrypted on the network. This is acceptable on a trusted LAN; an HTTPS reverse proxy is recommended.';

/**
 * Validate + normalize a user-entered Private Cloud base URL. Accepts only
 * http/https; returns the origin (scheme + host + port) without a trailing path.
 */
export function validateBaseUrl(
  input: string,
): { ok: true; value: ValidBaseUrl } | { ok: false; error: BaseUrlError } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'empty' };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'unsupported-protocol' };
  }
  return { ok: true, value: { baseUrl: url.origin, isHttp: url.protocol === 'http:' } };
}

/** The R-10 warning to show for a base URL, or undefined when it is HTTPS. */
export function httpWarningFor(base: ValidBaseUrl): string | undefined {
  return base.isHttp ? HTTP_OVER_LAN_WARNING : undefined;
}
