// @vitest-environment happy-dom
/**
 * stripHeadElements (F3-FR3 hardening) — remove head-only elements (`<meta>`,
 * `<link>`, `<base>`, `<title>`) that Readability/Parsoid leaves inside the body.
 *
 * The reported failure: the Supernote's EPUB engine (MuPDF 1.17) halts HTML
 * parsing at an in-body `<meta>` and drops everything after it, so a long
 * article shows as ~2 pages. The guard pins the actual failure mode — the TEXT
 * after an in-body `<meta>` must survive — not an arbitrary string shape. Runs
 * under happy-dom for DOMParser.
 */
import { describe, expect, it } from 'vitest';
import { stripHeadElements } from '@conversion/strip-head-elements';

describe('stripHeadElements', () => {
  it('removes an in-body <meta> while keeping the text before AND after it', () => {
    // The reported shape: lead prose, a stray Parsoid <meta>, then the article.
    const raw =
      '<p>Lead paragraph.</p>' +
      '<meta property="mw:PageProp/toc" />' +
      '<h2>Goals</h2><p>The rest of the article.</p>';

    const out = stripHeadElements(raw);

    expect(out).not.toContain('<meta');
    expect(out).toContain('Lead paragraph.');
    // The critical regression: content AFTER the meta must remain.
    expect(out).toContain('<h2>Goals</h2>');
    expect(out).toContain('The rest of the article.');
  });

  it('removes <link>, <base> and <title> left in the body', () => {
    const raw =
      '<base href="https://x/" /><link rel="stylesheet" href="x.css" />' +
      '<title>x</title><p>Body text</p>';

    const out = stripHeadElements(raw);

    expect(out).not.toContain('<link');
    expect(out).not.toContain('<base');
    expect(out).not.toContain('<title');
    expect(out).toContain('Body text');
  });

  it('removes multiple <meta> tags throughout the body', () => {
    const raw = '<meta name="a" /><p>One</p><meta name="b" /><p>Two</p>';

    const out = stripHeadElements(raw);

    expect(out).not.toContain('<meta');
    expect(out).toContain('One');
    expect(out).toContain('Two');
  });

  it('leaves content with no head-only elements unchanged', () => {
    const raw = '<h1>Title</h1><p>Just content.</p>';
    expect(stripHeadElements(raw)).toBe(raw);
  });

  it('keeps a data: <img> (does not touch flow content)', () => {
    const raw = '<p>x</p><img src="data:image/png;base64,AAA" alt="" /><p>y</p>';
    const out = stripHeadElements(raw);
    expect(out).toContain('data:image/png;base64,AAA');
    expect(out).toContain('x');
    expect(out).toContain('y');
  });

  it('returns "" for empty input', () => {
    expect(stripHeadElements('')).toBe('');
  });
});
