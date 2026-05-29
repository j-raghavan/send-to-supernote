// @vitest-environment happy-dom
/**
 * F3-AC5 / I-4 runtime guarantee — the live page DOM is NEVER mutated by Reader
 * extraction (clone-only).
 *
 * Other suites run on the `node` environment; this file opts into `happy-dom`
 * per-file (the directive above) so the real content-script extraction seam
 * (`src/content/reader.ts`, otherwise coverage-excluded as a DOM shell) runs
 * against an actual `Document`. We snapshot the live document before extraction
 * and assert it is byte-for-byte identical afterwards — Readability must operate
 * on a clone, leaving the user's page untouched. No network/chrome/Supernote.
 */
import { describe, expect, it } from 'vitest';
import { extractReaderFromDocument } from '../../src/content/reader';
import { isEmptyReaderExtract } from '@domain/capture';

/** Build a realistic article document in the happy-dom global `document`. */
function buildArticleDocument(): void {
  document.title = 'A Real Article';
  document.body.innerHTML = `
    <header id="site-nav"><a href="/">Home</a></header>
    <article>
      <h1>A Real Article</h1>
      <p class="byline">By A. Writer</p>
      <p>${'This is the first substantial paragraph of the article body. '.repeat(8)}</p>
      <p>${'A second paragraph with more than enough prose for Readability. '.repeat(8)}</p>
      <img src="https://cdn.example.com/figure.png" alt="figure" />
    </article>
    <footer id="site-footer">© 2026</footer>
  `;
}

describe('extractReaderFromDocument (F3-AC5 / I-4) — clone-only, no live mutation', () => {
  it('does not mutate the live document (full HTML snapshot is unchanged)', () => {
    buildArticleDocument();
    const before = document.documentElement.outerHTML;
    const beforeChildCount = document.body.childElementCount;

    extractReaderFromDocument(document);

    expect(document.documentElement.outerHTML).toBe(before);
    expect(document.body.childElementCount).toBe(beforeChildCount);
    // The chrome (nav/footer) Readability would strip on a clone is still present live.
    expect(document.getElementById('site-nav')).not.toBeNull();
    expect(document.getElementById('site-footer')).not.toBeNull();
    expect(document.querySelector('article')).not.toBeNull();
  });

  it('preserves the live <article> node identity after extraction (operated on a clone)', () => {
    buildArticleDocument();
    const liveArticle = document.querySelector('article');
    const liveImg = document.querySelector('img');

    extractReaderFromDocument(document);

    // The very same DOM nodes are still attached and unchanged.
    expect(document.querySelector('article')).toBe(liveArticle);
    expect(document.querySelector('img')).toBe(liveImg);
    expect(liveImg?.getAttribute('src')).toBe('https://cdn.example.com/figure.png');
  });

  it('returns an extract whose title falls back to the document title when present', () => {
    buildArticleDocument();
    const extract = extractReaderFromDocument(document);
    // Either Readability's parsed title or the document.title fallback — both
    // equal here; the point is extraction yields a usable, non-empty title.
    expect(extract.title.length).toBeGreaterThan(0);
    expect(typeof extract.content).toBe('string');
  });

  it('yields a short extract a non-article page maps to "try Full Page" — live DOM intact', () => {
    document.title = '';
    document.body.innerHTML = '<div id="widgets">charts only, no prose</div>';
    const liveWidgets = document.getElementById('widgets');

    const extract = extractReaderFromDocument(document);

    // A non-article page yields a sub-floor extract (< MIN_ARTICLE_LENGTH = 50),
    // which the domain's isEmptyReaderExtract maps to "try Full Page" (F3-AC4).
    expect(extract.length).toBeLessThan(50);
    expect(isEmptyReaderExtract(extract)).toBe(true);
    // …and the live DOM is untouched.
    expect(document.getElementById('widgets')).toBe(liveWidgets);
  });
});
