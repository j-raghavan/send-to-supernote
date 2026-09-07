/**
 * Protect capture-inlined images from Readability's lazy-image rewrite.
 *
 * The in-page capture snapshots each decoded `<img>` to a `data:` URI and makes
 * that the tag's `src` (apply-inline-images.ts). Readability then runs
 * `_fixLazyImages`, which for any `<img>` whose class contains "lazy" copies an
 * image URL parked in another attribute (`data-src`, `data-lazy-src`, …) back
 * over `src` — silently replacing the self-contained data URI with the REMOTE
 * URL. The EPUB step must then drop that remote image (an offline reader halts
 * on it), so every lazysizes/WordPress-style image vanished from the output.
 *
 * Readability only takes that path when the class contains "lazy" (an `<img>`
 * with a truthy `src` and no lazy class is returned early), so dropping the
 * `class` from an already-inlined `<img>` fully disarms it. Nothing is lost:
 * Readability strips every `class` attribute from its output anyway, and the
 * data URI is the single authoritative source. Untouched: images without a
 * `data:` src (still remote, nothing to protect) and non-lazy classes.
 *
 * Runs on the parsed DOM BEFORE Readability (render-parse-core.ts); uses DOM
 * globals only (the conversion layer may use the DOM, never `chrome.*`).
 * happy-dom unit-testable. Idempotent.
 */

/** Mirrors Readability's `className.toLowerCase().includes("lazy")` trigger. */
const LAZY_CLASS = /lazy/i;

/** Remove the lazy-loader class from every `<img>` already carrying a `data:` src. */
export function protectInlinedImages(root: ParentNode): void {
  root.querySelectorAll('img[src^="data:"]').forEach((img) => {
    if (LAZY_CLASS.test(img.getAttribute('class') ?? '')) {
      img.removeAttribute('class');
    }
  });
}
