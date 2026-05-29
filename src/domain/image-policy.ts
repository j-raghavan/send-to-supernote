/**
 * Image taint policy (F3-FR4) — pure classification, no DOM/network.
 *
 * When rendering, a cross-origin image can taint a canvas / fail to load. The
 * strategy: classify each image src so the pipeline can (a) keep
 * same-origin/data images as-is, (b) inline a cross-origin image via
 * host-permitted fetch, or (c) OMIT it — never aborting the capture.
 */

export type ImageDisposition =
  | 'safe' // data: URI or same-origin — no taint risk, render as-is
  | 'fetch' // cross-origin — attempt a host-permitted fetch + inline
  | 'omit'; // unusable src — drop it

/** Parse an image src to an absolute URL relative to the page, or undefined. */
function toUrl(src: string, pageUrl: string): URL | undefined {
  try {
    return new URL(src, pageUrl);
  } catch {
    return undefined;
  }
}

/**
 * Classify how a single image src should be handled relative to the page origin.
 * `data:`/`blob:` and same-origin are safe; a well-formed cross-origin URL is a
 * fetch candidate; anything unparseable is omitted.
 */
export function classifyImage(src: string, pageUrl: string): ImageDisposition {
  const trimmed = src.trim();
  if (trimmed.length === 0) {
    return 'omit';
  }
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return 'safe';
  }
  const url = toUrl(trimmed, pageUrl);
  if (url === undefined) {
    return 'omit';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'omit';
  }
  const page = toUrl(pageUrl, pageUrl);
  if (page !== undefined && url.origin === page.origin) {
    return 'safe';
  }
  return 'fetch';
}

/**
 * Whether a host-permitted fetch is allowed for an image's origin. The grants
 * are the origins the extension currently has host access to (static + runtime).
 * If granted we fetch+inline; otherwise the image is omitted (F4-FR4).
 */
export function canFetchImage(
  src: string,
  pageUrl: string,
  grantedOrigins: readonly string[],
): boolean {
  const url = toUrl(src, pageUrl);
  if (url === undefined) {
    return false;
  }
  return grantedOrigins.includes(url.origin);
}
