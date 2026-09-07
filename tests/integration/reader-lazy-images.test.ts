// @vitest-environment happy-dom
/**
 * Regression: capture-inlined images must survive Readability on lazy-loader
 * pages (the "EPUB arrives with no images" report against 1.5.9).
 *
 * Drives the REAL Readability through `parseReader` (no mocks) on an article
 * whose images carry the marks lazysizes / WordPress leave behind once loaded:
 * `class="lazyloaded"` plus a `data-src` / `data-lazy-src` still holding the
 * remote URL. Without the guard, Readability's `_fixLazyImages` copies that
 * remote URL back over the inlined `data:` src, and the EPUB step then strips
 * the image. Runs under happy-dom (DOMParser + Readability need a DOM).
 */
import { describe, expect, it } from 'vitest';
import { parseReader } from '@conversion/render-parse-core';
import { applyInlinedImages } from '@conversion/apply-inline-images';

// Long enough to clear Readability's 133-byte "placeholder" threshold.
const DATA = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAAAAACS'.repeat(6)}`;
const REMOTE = 'https://cdn.example.com/photo.jpg';
const PROSE = `<p>${'Substantial article prose so Readability scores this as the body. '.repeat(6)}</p>`;

function article(imgTag: string): string {
  return `<html><head><title>Story</title></head><body><nav><a href="/">Home</a></nav><article><h1>Story</h1>${PROSE}${imgTag}${PROSE}${PROSE}</article></body></html>`;
}

/** Simulate the capture: the page's <img> already rewritten to the data URI. */
function capture(imgTag: string): string {
  return applyInlinedImages(article(imgTag), [{ src: REMOTE, dataUri: DATA }]);
}

describe('parseReader keeps capture-inlined images on lazy-loader pages', () => {
  it.each([
    // data-* BEFORE src (the order lazysizes markup is authored in) exercises the
    // apply-inline-images attribute-name fix; src FIRST exercises the Readability
    // lazy-rewrite guard. Both must end with the data URI as the <img> src.
    ['lazysizes: data-src before src', `class="lazyloaded" data-src="${REMOTE}" src="${REMOTE}"`],
    ['lazysizes: src before data-src', `class="lazyloaded" src="${REMOTE}" data-src="${REMOTE}"`],
    [
      'WordPress: data-lazy-src + data-lazy-srcset before src',
      `class="wp-image-1 lazyloaded" data-lazy-src="${REMOTE}" data-lazy-srcset="${REMOTE}?w=300 300w" src="${REMOTE}"`,
    ],
  ])('%s — the data: src survives into the reader content', (_name, attrs) => {
    const extract = parseReader(capture(`<img ${attrs} alt="photo">`), REMOTE);

    expect(extract.content).toContain(DATA);
    // The <img>'s own src (not the data-* leftovers) must not have been rewritten back to remote.
    expect(extract.content).not.toMatch(/<img[^>]*\ssrc="https:/);
  });

  it('still keeps a plain (non-lazy) inlined image, unchanged behavior', () => {
    const extract = parseReader(capture(`<img src="${REMOTE}" alt="photo">`), REMOTE);

    expect(extract.content).toContain(DATA);
  });
});
