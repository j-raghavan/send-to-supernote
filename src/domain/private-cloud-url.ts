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

/**
 * Resolve the apply-returned upload URL onto the user's CONFIGURED base origin,
 * keeping ONLY the path + query (e.g. /api/oss/upload?token=...). F8-FR2 / D-3.
 *
 * Two reasons the host the apply response names must be discarded:
 *  - Reverse proxy: self-hosted servers behind a proxy commonly return an upload
 *    URL pointing at an INTERNAL origin (the app server's LAN address/port) that
 *    the browser can't reach. Re-basing on the configured base makes it work.
 *  - Safety: the multipart POST carries the JWT (x-access-token). An apply
 *    response must never be able to redirect that POST to an arbitrary foreign
 *    host, so we never trust its host — only its path + query.
 *
 * Accepts both absolute apply URLs (host stripped) and relative ones (resolved
 * against the base). Returns `undefined` for an apply URL we can't safely resolve
 * to an http(s) path on the configured base — a malformed absolute URL, or a
 * non-http(s) scheme (javascript:/data:/file:/...) — so the caller can surface a
 * clear "malformed upload URL" protocol error instead of POSTing the JWT-bearing
 * file to a guessed (almost-certainly-404) or unsafe target.
 *
 * Compatibility note: this deliberately overrides the host even when apply names
 * a different, externally reachable host — for self-hosted Private Cloud the only
 * trusted upload host is the user-configured one (D-3). Pure + covered.
 */
export function resolveUploadUrl(baseUrl: string, applyUrl: string): string | undefined {
  const base = baseUrl.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(applyUrl, `${base}/`);
  } catch {
    // Malformed absolute apply URL (a relative path never throws against a valid
    // base): reject, don't coerce — a guessed path would just 404 confusingly.
    return undefined;
  }
  // Boundary check: only http(s) is a valid upload target. A relative apply path
  // inherits the base's scheme; an absolute javascript:/data:/file: URL does not
  // throw above, so it must be rejected here rather than coerced to `${base}/...`.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  return `${base}${parsed.pathname}${parsed.search}`;
}

/** Host (without scheme/port) of a base URL, for an `http://host:19072` suggestion. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '<your-server-ip>';
  }
}

/**
 * Actionable message when a Private Cloud connection/upload FAILS AT THE NETWORK
 * LAYER (the request never completes — no HTTP status — e.g.
 * `TypeError: NetworkError` / "CORS request did not succeed"). Distinct from a
 * login rejection (wrong password), which returns a real status + its own message.
 *
 * A failed `fetch` does not tell us WHY (server down, wrong address/port,
 * firewall, or — for HTTPS — an untrusted certificate), so we LEAD WITH GENERIC
 * REACHABILITY for every scheme and only APPEND the HTTPS-specific notes when the
 * URL is HTTPS: a browser/extension `fetch` cannot bypass an untrusted
 * (self-signed) cert, and the stock Private Cloud serves plain HTTP on port
 * 19072. The host from `baseUrl` is substituted into the http:// suggestion.
 * Pure + covered; used by the SW (popup connect), the Options connect, and the
 * send-time adapter so connect and send stay equally diagnosable.
 */
export function privateCloudNetworkErrorHint(baseUrl: string): string {
  const base = `Couldn't reach your Private Cloud server at ${baseUrl}. Check the server is running and the address and port are correct, and that it's reachable from this device.`;
  if (baseUrl.toLowerCase().startsWith('https://')) {
    return `${base} If you're using HTTPS, your browser must also trust the server's certificate — a self-signed certificate must be imported into your OS/browser trust store (or use a CA-trusted cert). For a stock install, the server serves plain HTTP on port 19072 — try http://${hostOf(baseUrl)}:19072.`;
  }
  return base;
}
