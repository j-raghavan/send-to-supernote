/**
 * Image inlining for render (F3-FR4 / F3-AC3).
 *
 * Before rendering, resolve `<img>` sources: fetch each image (same-origin or
 * CORS/host-permitted) and inline it as a data URI so the offscreen renderer
 * does not depend on live network or canvas-tainting cross-origin loads. Images
 * that cannot be fetched are SKIPPED (the `<img>` removed) — never aborting the
 * whole render. Pure transform over HTML using an injected fetcher; fully
 * testable without a DOM or network.
 *
 * NOTE: this network-based path is currently UNWIRED (see RenderDeps.fetchImage);
 * the active mechanism is capture-time in-page canvas inlining. The maintained
 * `<img>`-rewrite variant (quote-aware tag matcher, entity decoding, $-safe
 * replacement) lives in apply-inline-images.ts — port fixes from there if this
 * path is ever reactivated.
 */

/** Fetches an image URL, returning a data URI, or undefined if it can't be fetched. */
export type ImageFetcher = (url: string) => Promise<string | undefined>;

export interface InlineImagesResult {
  html: string;
  inlined: number;
  skipped: number;
}

// Matches a whole <img ...> tag and captures its src attribute value.
const IMG_TAG = /<img\b[^>]*?>/gi;
const SRC_ATTR = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i;

function extractSrc(tag: string): string | undefined {
  const match = SRC_ATTR.exec(tag);
  if (!match) {
    return undefined;
  }
  return match[2] ?? match[3];
}

/** Already a data URI — keep as-is, no fetch needed. */
function isDataUri(src: string): boolean {
  return src.startsWith('data:');
}

function replaceSrc(tag: string, dataUri: string): string {
  return tag.replace(SRC_ATTR, `src="${dataUri}"`);
}

/**
 * Resolve images in the HTML. Each `<img>` is either inlined (fetch succeeded or
 * already a data URI) or removed (no usable src / fetch failed). Never throws.
 */
export async function inlineImages(
  html: string,
  fetchImage: ImageFetcher,
): Promise<InlineImagesResult> {
  const tags = html.match(IMG_TAG) ?? [];
  let result = html;
  let inlined = 0;
  let skipped = 0;

  for (const tag of tags) {
    const src = extractSrc(tag);
    if (src === undefined || src.length === 0) {
      result = result.replace(tag, '');
      skipped += 1;
      continue;
    }
    if (isDataUri(src)) {
      inlined += 1;
      continue;
    }
    const dataUri = await safeFetch(fetchImage, src);
    if (dataUri === undefined) {
      result = result.replace(tag, '');
      skipped += 1;
    } else {
      result = result.replace(tag, replaceSrc(tag, dataUri));
      inlined += 1;
    }
  }

  return { html: result, inlined, skipped };
}

async function safeFetch(fetchImage: ImageFetcher, url: string): Promise<string | undefined> {
  try {
    return await fetchImage(url);
  } catch {
    return undefined;
  }
}
