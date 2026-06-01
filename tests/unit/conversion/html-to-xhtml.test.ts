// @vitest-environment happy-dom
/**
 * toXhtml (F3-FR3 hardening) — normalize captured HTML into well-formed XHTML so
 * the EPUB chapter (parsed as strict XML by readers) does not break at the first
 * void element. Runs under happy-dom for DOMParser/XMLSerializer.
 *
 * Assertions are behavioural: the normalized fragment, embedded in a real EPUB
 * chapter, must parse as well-formed XML (no <parsererror>) AND retain its
 * content. The companion guard below proves the UNFIXED (verbatim) path breaks,
 * so the test pins the actual reported bug, not an arbitrary string shape.
 */
import { describe, expect, it } from 'vitest';
import { toXhtml } from '@conversion/html-to-xhtml';

/** Embed a body fragment in a minimal EPUB chapter and return its parsererror text (or null). */
function chapterParseError(bodyFragment: string): string | null {
  const chapter =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head>` +
    `<body><h1>t</h1>${bodyFragment}</body></html>`;
  const doc = new DOMParser().parseFromString(chapter, 'application/xml');
  return doc.querySelector('parsererror')?.textContent ?? null;
}

describe('toXhtml', () => {
  it('reproduces the bug: raw HTML with a non-self-closed <img> breaks the chapter XML', () => {
    // The exact shape from the report: an <img> wrapped in an <a> (no /> on img).
    const raw =
      '<p>Intro</p><a href="https://x"><img src="data:image/png;base64,AAAA"></a><p>More</p>';
    expect(chapterParseError(raw)).not.toBeNull();
  });

  it('self-closes void elements so the chapter parses as well-formed XML', () => {
    const raw =
      '<p>Intro</p><a href="https://x"><img src="data:image/png;base64,AAAA"></a><br>tail<hr>';
    const xhtml = toXhtml(raw);
    expect(chapterParseError(xhtml)).toBeNull();
  });

  it('keeps content (text + image src) intact after normalization', () => {
    const raw = '<p>Para one</p><img src="data:image/png;base64,ZZZ"><p>Para two</p>';
    const xhtml = toXhtml(raw);
    expect(chapterParseError(xhtml)).toBeNull();
    expect(xhtml).toContain('Para one');
    expect(xhtml).toContain('Para two');
    expect(xhtml).toContain('data:image/png;base64,ZZZ');
  });

  it('produces valid XML for entities and special characters', () => {
    const raw = '<p>AT&amp;T &lt;tag&gt; and "quotes"</p>';
    const xhtml = toXhtml(raw);
    expect(chapterParseError(xhtml)).toBeNull();
  });

  it('strips the body wrapper (no nested <body> leaks into the chapter)', () => {
    const xhtml = toXhtml('<p>hi</p>');
    expect(xhtml).not.toContain('<body');
    expect(xhtml).not.toContain('</body>');
    expect(xhtml).toContain('hi');
  });

  it('returns an empty fragment for empty input', () => {
    expect(toXhtml('').trim()).toBe('');
  });

  it('passes plain text through', () => {
    const xhtml = toXhtml('just text');
    expect(xhtml).toContain('just text');
    expect(chapterParseError(xhtml)).toBeNull();
  });
});
