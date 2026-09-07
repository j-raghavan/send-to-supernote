/**
 * In-page-captured image inlining (Issue 1).
 *
 * Reader mode previously rendered `<img>` as "[image]"/blank because the
 * captured HTML still pointed at live (often cross-origin) URLs that the
 * offscreen/direct renderer cannot load. The fix captures the already-decoded
 * `<img>` bitmaps in the page via a canvas (see scripting-extractor.ts) and
 * hands them here as `data:` URIs.
 *
 * This module is a PURE string transform: given the captured HTML and the list
 * of captured images, it rewrites each matching `<img>` tag's `src` to the
 * inlined data URI. It does no DOM work (regex only) so it runs under the node
 * test env, and scripting-extractor.ts is c8-ignored — so ALL the inlining
 * logic that CAN be tested lives here. Idempotent and never throws.
 *
 * Rewritten-tag note: a rewritten tag keeps ONLY `src` (now the data URI),
 * `alt`, `class`, `width`, `height`, and `style`. Everything else is dropped —
 * `srcset`/`sizes`, and every lazy-loader/CMS attribute that parks a copy of the
 * remote URL (`data-src`, `data-lazy-src`, `nitro-lazy-src`, a `title` that is a
 * filename, …). Readability's `_fixLazyImages` copies ANY such attribute back
 * over `src` for a "lazy"-classed <img> (and, for a tiny data URI, even without
 * the class), which un-inlined the image so the EPUB step then had to drop it.
 * With nothing left to copy, Readability keeps the data URI; `class` stays so
 * its unlikely-candidate filtering still applies. Images the capture did NOT
 * inline (a page-authored LQIP placeholder, a remote src) are untouched.
 *
 * Match-key note: the captured images are keyed on `img.getAttribute('src')`,
 * which is the DECODED attribute value, but the `src=` text in the captured
 * outerHTML is HTML-ENTITY-ENCODED (e.g. a URL `a.jpg?w=1&h=2` serializes as
 * `a.jpg?w=1&amp;h=2`). So each tag's extracted `src` is entity-decoded before
 * the lookup — otherwise any URL containing `&` (most CDN/query-param images)
 * would never match and stay un-inlined.
 */

/** A page-captured image: its raw `src` attribute value plus the inlined data URI. */
export interface CapturedImage {
  src: string;
  srcset?: string;
  dataUri: string;
}

// Matches a whole <img ...> tag, skipping over quoted attribute values so a `>`
// inside an attribute (e.g. alt="a>b") does not truncate the match. The
// attribute matchers operate tag-scoped on the match.
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
// The REAL `src` — not the tail of a lazy-loader's `data-src`: a plain `\b`
// sits happily between the `-` and the `s`, so the lookbehind also rejects a
// preceding hyphen (or word char).
const SRC_ATTR = /(?<![\w-])src\s*=\s*("([^"]*)"|'([^']*)')/i;
// One attribute: name, then an optional quoted/unquoted value.
const ATTR = /\s([^\s=>"'/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
// Attributes a rewritten <img> keeps besides `src` (see the note above).
const KEPT_ATTRS = new Set(['alt', 'class', 'width', 'height', 'style']);

// Decode the HTML entities a serializer emits in attribute values, in ONE pass
// (so `&amp;lt;` decodes to `&lt;`, not `<`). Named set + numeric dec/hex.
const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as const;

function decodeEntities(value: string): string {
  return value.replace(ENTITY, (_match, dec: string, hex: string, name: string) => {
    if (dec !== undefined) {
      return String.fromCodePoint(Number(dec));
    }
    if (hex !== undefined) {
      return String.fromCodePoint(parseInt(hex, 16));
    }
    // `name` is always one of the alternation's named entities (regex-guaranteed).
    return NAMED_ENTITIES[name as keyof typeof NAMED_ENTITIES];
  });
}

/**
 * Rebuild an `<img>` tag around the data URI: `src` is replaced in place (order
 * preserved) and only the KEPT_ATTRS survive alongside it.
 */
function rewriteTag(tag: string, dataUri: string): string {
  const attrs: string[] = [];
  for (const match of tag.slice('<img'.length, -1).matchAll(ATTR)) {
    const [, name, value] = match;
    const lower = name!.toLowerCase();
    if (lower === 'src') {
      attrs.push(`src="${dataUri}"`);
    } else if (KEPT_ATTRS.has(lower)) {
      attrs.push(value === undefined ? name! : `${name}=${value}`);
    }
  }
  return `<img ${attrs.join(' ')}>`;
}

function extractSrc(tag: string): string | undefined {
  const match = SRC_ATTR.exec(tag);
  if (!match) {
    return undefined;
  }
  return match[2] ?? match[3];
}

/**
 * Inline page-captured images into the HTML. Each `<img>` whose raw `src`
 * matches a captured image has its `src` rewritten to the data URI and every
 * attribute outside the kept set dropped (the data URI is the single
 * authoritative source — see the rewritten-tag note above). Tags
 * without a `src`, or whose `src` was not captured (already `data:`,
 * cross-origin-tainted, over caps), are left untouched. Empty `images`
 * leaves the HTML unchanged. Idempotent and never throws.
 */
export function applyInlinedImages(html: string, images: readonly CapturedImage[]): string {
  if (images.length === 0) {
    return html;
  }

  // Key on the RAW literal attribute value (possibly relative); no URL resolution.
  const bySrc = new Map<string, CapturedImage>();
  for (const image of images) {
    bySrc.set(image.src, image);
  }

  // Single callback pass: each <img> tag is rewritten in isolation, so duplicate
  // identical tags are all handled (unlike a first-occurrence string replace).
  return html.replace(IMG_TAG, (tag) => {
    const src = extractSrc(tag);
    if (src === undefined) {
      return tag;
    }
    // Decode the serializer's entity-encoding (e.g. `&amp;` → `&`) so the tag's
    // src matches the DECODED key the images were captured under.
    const image = bySrc.get(decodeEntities(src));
    if (image === undefined) {
      return tag;
    }
    // Tag-scoped rebuild (no string substitution, so a `$` in the data URI is
    // never treated as a replacement pattern).
    return rewriteTag(tag, image.dataUri);
  });
}
