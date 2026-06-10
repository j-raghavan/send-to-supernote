// @vitest-environment happy-dom
/**
 * render-parse-core (FF2-FR7, I-F7, ADR-FIREFOX-PORT D2/D7) — the single home for
 * the render-to-bytes + reader-parse logic shared by the Chrome offscreen
 * dispatcher and the Firefox direct adapters.
 *
 * Runs under happy-dom (needs `document`, `DOMParser`, `crypto.randomUUID`). The
 * heavy DOM renderers (`renderEpub`/`renderHtmlToPdf` — jsPDF/jszip) and the
 * Readability seam (`extractReaderFromDocument`) are mocked at the module
 * boundary so these tests assert ROUTING + delegation, not real PDF/EPUB bytes
 * or Readability internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderExtract } from '@domain/capture';
import { resolveRenderOptions } from '@domain/conversion';

// Mock the DOM-bound renderers (relative to render-parse-core's location).
const renderEpub = vi.fn((_input: unknown) => Promise.resolve(new Uint8Array([1, 2, 3, 4])));
const renderHtmlToPdf = vi.fn((_html: string, _pageSize: string) =>
  Promise.resolve(new Uint8Array([9, 8, 7])),
);
vi.mock('../../../src/offscreen/epub-renderer', () => ({
  renderEpub: (input: unknown) => renderEpub(input),
}));
vi.mock('../../../src/offscreen/pdf-renderer', () => ({
  renderHtmlToPdf: (html: string, pageSize: string) => renderHtmlToPdf(html, pageSize),
}));

// Mock the Readability seam so we drive the happy-path vs body-fallback branches
// deterministically (Readability internals are exercised in reader-dom.test.ts).
const extractReaderFromDocument = vi.fn<(doc: Document) => ReaderExtract>();
vi.mock('../../../src/content/reader', () => ({
  extractReaderFromDocument: (doc: Document) => extractReaderFromDocument(doc),
}));

// Imported after the mocks are registered (vi.mock is hoisted anyway).
import { titleFromHtml, renderToBytes, parseReader } from '@conversion/render-parse-core';

describe('titleFromHtml', () => {
  afterEach(() => {
    // Set a renderer-context title to PROVE titleFromHtml never leaks it.
    document.title = '';
  });

  it('returns the trimmed first <h1> text when present', () => {
    expect(titleFromHtml('<h1>  X  </h1>')).toBe('X');
  });

  it("falls back to 'Document' when there is no <h1> (never the renderer's document.title)", () => {
    // Regression: titleFromHtml used to return document.title here, leaking
    // "Send to Supernote — Offscreen Renderer" into the EPUB. It must not.
    document.title = 'Send to Supernote — Offscreen Renderer';
    expect(titleFromHtml('<p>no heading here</p>')).toBe('Document');
  });

  it("falls back to 'Document' when the <h1> is empty/whitespace", () => {
    document.title = 'Send to Supernote — Offscreen Renderer';
    expect(titleFromHtml('<h1>   </h1><p>body</p>')).toBe('Document');
  });
});

describe('renderToBytes (routing — FF2-FR7)', () => {
  beforeEach(() => {
    renderEpub.mockClear();
    renderHtmlToPdf.mockClear();
    document.title = '';
  });

  it('routes EPUB to renderEpub with title/bodyHtml/urn:uuid identifier, normalizing to XHTML', async () => {
    // A non-self-closed <img> (HTML5 serialization) must reach renderEpub as
    // well-formed XHTML, else the EPUB chapter breaks at the first image.
    const html = '<h1>My Title</h1><p>body</p><img src="data:image/png;base64,AAAA">';
    const bytes = await renderToBytes(html, resolveRenderOptions('epub'));

    expect(renderHtmlToPdf).not.toHaveBeenCalled();
    expect(renderEpub).toHaveBeenCalledTimes(1);
    const input = renderEpub.mock.calls[0]![0] as {
      title: string;
      bodyHtml: string;
      identifier: string;
    };
    expect(input.title).toBe('My Title'); // fed by titleFromHtml(html) when no options.title
    expect(input.bodyHtml).toContain('body');
    expect(input.bodyHtml).toContain('data:image/png;base64,AAAA');
    expect(input.bodyHtml).not.toMatch(/<img[^>]*[^/]>/); // <img> is self-closed, not left open
    // The normalized fragment embeds into an EPUB chapter as well-formed XML.
    const chapter = `<html xmlns="http://www.w3.org/1999/xhtml"><body>${input.bodyHtml}</body></html>`;
    expect(
      new DOMParser().parseFromString(chapter, 'application/xml').querySelector('parsererror'),
    ).toBeNull();
    expect(input.identifier).toMatch(/^urn:uuid:[0-9a-f-]{36}$/i);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it('strips a remote <img> from the EPUB body while keeping the text after it', async () => {
    // Reported failure: a remote lead image a few paragraphs in makes the offline
    // reader halt, dropping the rest of the article. The remote image must be
    // gone from bodyHtml and the trailing prose must survive.
    const html =
      '<h1>T</h1><p>Lead para</p>' +
      '<figure><img src="https://ichef.bbci.co.uk/news/480/photo.jpg.webp" alt="x" /></figure>' +
      '<p>Body that must not be dropped</p>';
    await renderToBytes(html, resolveRenderOptions('epub'));

    const input = renderEpub.mock.calls[0]![0] as { bodyHtml: string };
    expect(input.bodyHtml).not.toContain('<img');
    expect(input.bodyHtml).not.toContain('ichef.bbci.co.uk');
    expect(input.bodyHtml).toContain('Lead para');
    expect(input.bodyHtml).toContain('Body that must not be dropped');
  });

  it('prefers the real options.title over the content <h1> for the EPUB', async () => {
    const html = '<h1>Heading In Content</h1><p>body</p>';
    await renderToBytes(html, { ...resolveRenderOptions('epub'), title: '  Real Article Title  ' });

    const input = renderEpub.mock.calls[0]![0] as { title: string };
    expect(input.title).toBe('Real Article Title'); // trimmed options.title wins
  });

  it('falls back to titleFromHtml when options.title is blank', async () => {
    const html = '<h1>From Content</h1>';
    await renderToBytes(html, { ...resolveRenderOptions('epub'), title: '   ' });

    const input = renderEpub.mock.calls[0]![0] as { title: string };
    expect(input.title).toBe('From Content');
  });

  it('routes PDF to renderHtmlToPdf(html, pageSize)', async () => {
    const html = '<p>pdf body</p>';
    const bytes = await renderToBytes(html, resolveRenderOptions('pdf', 'letter'));

    expect(renderEpub).not.toHaveBeenCalled();
    expect(renderHtmlToPdf).toHaveBeenCalledTimes(1);
    expect(renderHtmlToPdf).toHaveBeenCalledWith(html, 'letter');
    expect(Array.from(bytes)).toEqual([9, 8, 7]);
  });
});

describe('renderToBytes — Include images off (per-send text-only)', () => {
  beforeEach(() => {
    renderEpub.mockClear();
    renderHtmlToPdf.mockClear();
    document.title = '';
  });

  it('strips a data: <img> BEFORE the PDF branch when includeImages:false', async () => {
    // The image is stripped at render time, so the html handed to the PDF
    // renderer contains no <img> (and no inline bytes) even though the capture
    // inlined one.
    const html = '<p>before</p><img src="data:image/png;base64,AAAA" alt="x" /><p>after</p>';
    await renderToBytes(html, { ...resolveRenderOptions('pdf', 'a4'), includeImages: false });

    expect(renderEpub).not.toHaveBeenCalled();
    const handed = renderHtmlToPdf.mock.calls[0]![0];
    expect(handed).not.toContain('<img');
    expect(handed).not.toContain('data:image/png;base64,AAAA');
    expect(handed).toContain('before');
    expect(handed).toContain('after');
  });

  it('strips a data: <img> BEFORE the EPUB branch when includeImages:false', async () => {
    const html =
      '<h1>T</h1><p>before</p><img src="data:image/png;base64,AAAA" alt="x" /><p>after</p>';
    await renderToBytes(html, { ...resolveRenderOptions('epub', 'a4'), includeImages: false });

    expect(renderHtmlToPdf).not.toHaveBeenCalled();
    const input = renderEpub.mock.calls[0]![0] as { bodyHtml: string };
    expect(input.bodyHtml).not.toContain('<img');
    expect(input.bodyHtml).not.toContain('data:image/png;base64,AAAA');
    expect(input.bodyHtml).toContain('before');
    expect(input.bodyHtml).toContain('after');
  });

  it('KEEPS the data: <img> for PDF when includeImages:true', async () => {
    const html = '<p>before</p><img src="data:image/png;base64,AAAA" alt="x" /><p>after</p>';
    await renderToBytes(html, { ...resolveRenderOptions('pdf', 'a4'), includeImages: true });

    const handed = renderHtmlToPdf.mock.calls[0]![0];
    expect(handed).toContain('data:image/png;base64,AAAA');
  });

  it('KEEPS the data: <img> for EPUB when includeImages is undefined (strict === false guard)', async () => {
    // An older caller that omits includeImages must keep the images-on behavior:
    // the data: image survives into the EPUB body (only remote images are dropped
    // by the EPUB self-containment pass).
    const html =
      '<h1>T</h1><p>before</p><img src="data:image/png;base64,AAAA" alt="x" /><p>after</p>';
    // Drop includeImages entirely to model an older caller; the strict `=== false`
    // guard treats `undefined` as images-on.
    const { includeImages: _omit, ...options } = resolveRenderOptions('epub', 'a4');
    await renderToBytes(html, options as ReturnType<typeof resolveRenderOptions>);

    const input = renderEpub.mock.calls[0]![0] as { bodyHtml: string };
    expect(input.bodyHtml).toContain('data:image/png;base64,AAAA');
  });
});

describe('parseReader (FF2-FR3/FR4)', () => {
  beforeEach(() => {
    extractReaderFromDocument.mockReset();
  });

  it('returns the Readability article when extraction is non-empty (happy path)', () => {
    const article: ReaderExtract = {
      title: 'Real Article',
      content: '<p>plenty of real article prose here for the reader extract.</p>',
      length: 500,
    };
    extractReaderFromDocument.mockReturnValue(article);

    const result = parseReader('<article><h1>Real Article</h1></article>', 'https://ex.com/a');

    expect(result).toEqual(article);
  });

  it('injects a <base href=url> so relative URLs resolve against the original page', () => {
    let captured: Document | undefined;
    extractReaderFromDocument.mockImplementation((doc) => {
      captured = doc;
      return { title: 'A', content: '<p>enough content for a non-empty extract.</p>', length: 200 };
    });

    parseReader('<p>relative refs</p>', 'https://example.com/path/');

    const base = captured?.querySelector('base');
    expect(base).not.toBeNull();
    expect(base?.getAttribute('href')).toBe('https://example.com/path/');
    // It is the FIRST child of <head> (prepended).
    expect(captured?.head?.firstElementChild?.tagName.toLowerCase()).toBe('base');
  });

  it('falls back to the page <body> (scripts/styles/embeds stripped) when Readability misses', () => {
    // Empty-extract (length below the floor) forces the body fallback.
    extractReaderFromDocument.mockReturnValue({ title: '', content: '', length: 0 });

    // Note: src/href attributes are omitted so happy-dom does not attempt to
    // fetch subresources during DOMParser parsing — the TAGS are what we assert
    // get stripped, not their network behaviour.
    const html = `<!doctype html><html><head><title>Docs Site</title></head><body>
      <script>evil()</script>
      <style>.x{color:red}</style>
      <noscript>noscript-text</noscript>
      <iframe></iframe>
      <svg><rect/></svg>
      <link rel="stylesheet" />
      <main><p>Real readable prose that should survive the strip.</p></main>
    </body></html>`;

    const result = parseReader(html, 'https://docs.example.com/');

    expect(result.title).toBe('Docs Site');
    // Stripped tags must NOT appear in content.
    expect(result.content).not.toMatch(/<script/i);
    expect(result.content).not.toMatch(/<style/i);
    expect(result.content).not.toMatch(/<noscript/i);
    expect(result.content).not.toMatch(/<iframe/i);
    expect(result.content).not.toMatch(/<svg/i);
    expect(result.content).not.toMatch(/<link/i);
    // The real prose survives.
    expect(result.content).toContain('Real readable prose that should survive the strip.');
    // length is the trimmed textContent length of the cleaned body.
    expect(result.length).toBeGreaterThan(0);
  });

  it('uses the "Page" title fallback when the document has no <title> on the body path', () => {
    extractReaderFromDocument.mockReturnValue({ title: '', content: '', length: 0 });

    const result = parseReader(
      '<body><p>some words but no title element</p></body>',
      'https://x.test/',
    );

    expect(result.title).toBe('Page');
  });
});
