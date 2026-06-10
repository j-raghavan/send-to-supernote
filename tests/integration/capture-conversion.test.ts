/**
 * F3 capture → conversion behavior tests (mocked Extractor + Renderer fakes).
 *
 * These wire the covered use cases (captureReader -> renderDocument) and the
 * EPUB/image domain together to cover the Acceptance Criteria end-to-end. The
 * DOM-bound rendering itself is the coverage-excluded offscreen adapter; here we
 * assert the decisions and the flow that drive a correct paginated PDF / valid
 * EPUB. No network/chrome/DOM.
 *
 *  - F3-AC1: a long-form article captures + renders to a paginated PDF carrying
 *            the article title.
 *  - F3-AC2: defaultFormat=epub produces a structurally valid reflowable EPUB.
 *  - F3-AC4: cross-origin (canvas-tainting) images are omitted (or inlined when
 *            granted) before rendering — never aborting the send.
 */
import { describe, expect, it } from 'vitest';
import { captureReader } from '../../src/capture/capture-reader';
import { renderDocument } from '../../src/conversion/render-document';
import { buildEpubFiles } from '../../src/conversion/epub-builder';
import { type ImageFetcher } from '../../src/conversion/inline-images';
import { canFetchImage, classifyImage } from '@domain/image-policy';
import { FakeExtractor } from '../fakes/fake-extractor';
import { FakeRenderer } from '../fakes/fake-renderer';

describe('F3-AC1 — long-form article → multi-page PDF with the title', () => {
  it('captures the article and renders a paginated PDF carrying the title', async () => {
    const body = `<h1>The Long Read</h1>${'<p>Substantial article prose. </p>'.repeat(40)}`;
    const extractor = new FakeExtractor({
      title: 'The Long Read',
      byline: 'By Reporter',
      content: body,
      length: 8000,
    });
    const renderer = new FakeRenderer();

    const captured = await captureReader({ extractor }, true);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.value.title).toBe('The Long Read');

    const rendered = await renderDocument(
      { renderer },
      { document: captured.value, format: 'pdf', includeImages: true },
    );

    expect(rendered.ok).toBe(true);
    // PDF lays out HTML directly and paginates.
    expect(renderer.calls[0]!.options.paginate).toBe(true);
    // The rendered HTML carries the article title + body (becomes the PDF text).
    expect(renderer.calls[0]!.html).toContain('The Long Read');
    expect(renderer.calls[0]!.html).toContain('Substantial article prose');
    if (rendered.ok) expect(rendered.value.contentType).toBe('application/pdf');
  });
});

describe('F3-AC2 — defaultFormat=epub → a valid reflowable EPUB', () => {
  it('renders with the EPUB content type and reflowable (no pagination)', async () => {
    const extractor = new FakeExtractor({
      title: 'EPUB Article',
      content: `<p>${'reflow me '.repeat(30)}</p>`,
      length: 600,
    });
    const renderer = new FakeRenderer();

    const captured = await captureReader({ extractor }, true);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const rendered = await renderDocument(
      { renderer },
      { document: captured.value, format: 'epub', includeImages: true },
    );

    expect(rendered.ok && rendered.value.contentType).toBe('application/epub+zip');
    // EPUB is reflowable: not paginated.
    expect(renderer.calls[0]!.options.paginate).toBe(false);
  });

  it('the EPUB file set is structurally valid (mimetype-first/uncompressed, opf, nav, chapter)', () => {
    const files = buildEpubFiles({
      title: 'EPUB Article',
      bodyHtml: '<p>Body.</p>',
      identifier: 'urn:uuid:abc',
    });

    // EPUB OCF: the mimetype entry MUST be first and stored (uncompressed).
    expect(files[0]!.path).toBe('mimetype');
    expect(files[0]!.content).toBe('application/epub+zip');
    expect(files[0]!.store).toBe(true);

    const byPath = new Map(files.map((f) => [f.path, f.content]));
    // container.xml points the reader at the OPF.
    expect(byPath.get('META-INF/container.xml')).toContain('OEBPS/content.opf');
    // OPF declares EPUB 3 package with title + spine + manifest.
    const opf = byPath.get('OEBPS/content.opf')!;
    expect(opf).toContain('<package');
    expect(opf).toContain('version="3.0"');
    expect(opf).toContain('<dc:title>EPUB Article</dc:title>');
    expect(opf).toContain('<spine>');
    // nav + chapter are present and linked.
    expect(byPath.get('OEBPS/nav.xhtml')).toContain('chapter.xhtml');
    expect(byPath.get('OEBPS/chapter.xhtml')).toContain('<p>Body.</p>');
  });
});

describe('F3-AC4 — cross-origin images: rendered with taints omitted, never aborts', () => {
  const PAGE = 'https://recipes.example.com/cake';

  it('classifies a canvas-tainting cross-origin image as a fetch candidate, gated by grant', () => {
    // A cross-origin image is a fetch candidate; if its origin is NOT granted it
    // must be omitted (not drawn → no canvas taint), never aborting the send.
    expect(classifyImage('https://cdn.thirdparty.com/photo.jpg', PAGE)).toBe('fetch');
    expect(canFetchImage('https://cdn.thirdparty.com/photo.jpg', PAGE, [])).toBe(false);
    // A same-origin image is safe to draw directly.
    expect(classifyImage('/img/local.png', PAGE)).toBe('safe');
  });

  it('renders with an un-fetchable cross-origin image omitted (no error)', async () => {
    const captured = {
      mode: 'reader' as const,
      title: 'Cake',
      html: '<h1>Cake</h1><img src="https://cdn.thirdparty.com/photo.jpg"><p>Steps.</p>',
    };
    const renderer = new FakeRenderer();
    // The host-permitted fetch is denied (origin not granted) → image omitted.
    const denyFetch: ImageFetcher = () => Promise.resolve(undefined);

    const rendered = await renderDocument(
      { renderer, fetchImage: denyFetch },
      { document: captured, format: 'pdf', includeImages: true },
    );

    // The render still succeeds; the tainting image is gone, content stays.
    expect(rendered.ok).toBe(true);
    expect(renderer.calls[0]!.html).not.toContain('cdn.thirdparty.com');
    expect(renderer.calls[0]!.html).toContain('<h1>Cake</h1>');
    expect(renderer.calls[0]!.html).toContain('<p>Steps.</p>');
  });

  it('inlines a granted cross-origin image instead of omitting it', async () => {
    const captured = {
      mode: 'reader' as const,
      title: 'Cake',
      html: '<img src="https://cdn.thirdparty.com/photo.jpg">',
    };
    const renderer = new FakeRenderer();
    const grantFetch: ImageFetcher = (url) =>
      Promise.resolve(`data:image/jpeg;base64,${btoa(url)}`);

    const rendered = await renderDocument(
      { renderer, fetchImage: grantFetch },
      { document: captured, format: 'pdf', includeImages: true },
    );

    expect(rendered.ok).toBe(true);
    expect(renderer.calls[0]!.html).toContain('data:image/jpeg;base64,');
    expect(renderer.calls[0]!.html).not.toContain('https://cdn.thirdparty.com/photo.jpg');
  });
});
