/**
 * F3/F4 capture → conversion behavior tests (mocked Extractor + Renderer fakes).
 *
 * These wire the covered use cases (captureReader / captureFullPage ->
 * renderDocument) and the layout/EPUB domain together to cover the Acceptance
 * Criteria end-to-end for what Batch 2 built. The DOM-bound rendering itself is
 * the coverage-excluded offscreen adapter; here we assert the decisions and the
 * flow that drive a correct paginated PDF / valid EPUB. No network/chrome/DOM.
 *
 *  - F3-AC1: a long-form article captures + renders to a paginated PDF carrying
 *            the article title (multi-page geometry via tilePages).
 *  - F3-AC2: defaultFormat=epub produces a structurally valid reflowable EPUB.
 *  - F4-AC1: a multi-screen page paginates over the FULL document height.
 *  - F4-AC2: a Full Page with cross-origin (canvas-tainting) images is produced
 *            with those images omitted — never aborting the capture.
 */
import { describe, expect, it } from 'vitest';
import { captureReader } from '../../src/capture/capture-reader';
import { captureFullPage } from '../../src/capture/capture-fullpage';
import { renderDocument } from '../../src/conversion/render-document';
import { buildEpubFiles } from '../../src/conversion/epub-builder';
import { type ImageFetcher } from '../../src/conversion/inline-images';
import { scrollPlan, tilePages } from '@domain/fullpage-layout';
import { canFetchImage, classifyImage } from '@domain/image-policy';
import { FakeExtractor } from '../fakes/fake-extractor';
import { FakeRenderer } from '../fakes/fake-renderer';

const A4_PAGE_HEIGHT = 1123; // px @ 96dpi, for pagination math
const MAX_PAGES = 50;

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

    const captured = await captureReader({ extractor });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.value.title).toBe('The Long Read');

    const rendered = await renderDocument(
      { renderer },
      { document: captured.value, format: 'pdf' },
    );

    expect(rendered.ok).toBe(true);
    // Reader PDF lays out HTML directly (not rasterized) and paginates.
    expect(renderer.calls[0]!.options.paginate).toBe(true);
    expect(renderer.calls[0]!.options.rasterize).toBe(false);
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

    const captured = await captureReader({ extractor });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const rendered = await renderDocument(
      { renderer },
      { document: captured.value, format: 'epub' },
    );

    expect(rendered.ok && rendered.value.contentType).toBe('application/epub+zip');
    // EPUB is reflowable: not paginated, not rasterized.
    expect(renderer.calls[0]!.options.paginate).toBe(false);
    expect(renderer.calls[0]!.options.rasterize).toBe(false);
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

describe('F4-AC1 — multi-screen page → paginated PDF over the full height', () => {
  it('captures Full Page and rasterizes to a paginated PDF', async () => {
    const extractor = new FakeExtractor(undefined, {
      title: 'Tall Recipe',
      html: '<html><body>'.concat('<section>row</section>'.repeat(60), '</body></html>'),
    });
    const renderer = new FakeRenderer();

    const captured = await captureFullPage({ extractor });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.value.mode).toBe('fullpage');

    const rendered = await renderDocument(
      { renderer },
      { document: captured.value, format: 'pdf' },
    );

    expect(rendered.ok).toBe(true);
    // Full Page PDF rasterizes via html2canvas (F4-FR2) and paginates.
    expect(renderer.calls[0]!.options.rasterize).toBe(true);
    expect(renderer.calls[0]!.options.paginate).toBe(true);
  });

  it('paginates over the FULL document height (last tile covers the remainder)', () => {
    // A document 3.5 pages tall → 4 tiles covering 0..totalHeight, none lost.
    const totalHeight = Math.round(A4_PAGE_HEIGHT * 3.5);
    const { tiles, capped } = tilePages(totalHeight, A4_PAGE_HEIGHT, MAX_PAGES);

    expect(capped).toBe(false);
    expect(tiles).toHaveLength(4);
    expect(tiles[0]!.top).toBe(0);
    // The tiles tile the whole height with no gap and no overrun.
    const lastTile = tiles[tiles.length - 1]!;
    expect(lastTile.top + lastTile.height).toBe(totalHeight);
    // The scroll plan visits every viewport step and finishes at the bottom.
    const plan = scrollPlan(totalHeight, A4_PAGE_HEIGHT);
    expect(plan[0]).toBe(0);
    expect(plan[plan.length - 1]).toBe(totalHeight - A4_PAGE_HEIGHT);
  });
});

describe('F4-AC2 — cross-origin images: produced with taints omitted, never aborts', () => {
  const PAGE = 'https://recipes.example.com/cake';

  it('classifies a canvas-tainting cross-origin image as a fetch candidate, gated by grant', () => {
    // A cross-origin image is a fetch candidate; if its origin is NOT granted it
    // must be omitted (not drawn → no canvas taint), never aborting capture.
    expect(classifyImage('https://cdn.thirdparty.com/photo.jpg', PAGE)).toBe('fetch');
    expect(canFetchImage('https://cdn.thirdparty.com/photo.jpg', PAGE, [])).toBe(false);
    // A same-origin image is safe to draw directly.
    expect(classifyImage('/img/local.png', PAGE)).toBe('safe');
  });

  it('renders the Full Page with an un-fetchable cross-origin image omitted (no error)', async () => {
    const captured = {
      mode: 'fullpage' as const,
      title: 'Cake',
      html: '<h1>Cake</h1><img src="https://cdn.thirdparty.com/photo.jpg"><p>Steps.</p>',
    };
    const renderer = new FakeRenderer();
    // The host-permitted fetch is denied (origin not granted) → image omitted.
    const denyFetch: ImageFetcher = () => Promise.resolve(undefined);

    const rendered = await renderDocument(
      { renderer, fetchImage: denyFetch },
      { document: captured, format: 'pdf' },
    );

    // Capture/render still succeeds; the tainting image is gone, content stays.
    expect(rendered.ok).toBe(true);
    expect(renderer.calls[0]!.html).not.toContain('cdn.thirdparty.com');
    expect(renderer.calls[0]!.html).toContain('<h1>Cake</h1>');
    expect(renderer.calls[0]!.html).toContain('<p>Steps.</p>');
  });

  it('inlines a granted cross-origin image instead of omitting it', async () => {
    const captured = {
      mode: 'fullpage' as const,
      title: 'Cake',
      html: '<img src="https://cdn.thirdparty.com/photo.jpg">',
    };
    const renderer = new FakeRenderer();
    const grantFetch: ImageFetcher = (url) =>
      Promise.resolve(`data:image/jpeg;base64,${btoa(url)}`);

    const rendered = await renderDocument(
      { renderer, fetchImage: grantFetch },
      { document: captured, format: 'pdf' },
    );

    expect(rendered.ok).toBe(true);
    expect(renderer.calls[0]!.html).toContain('data:image/jpeg;base64,');
    expect(renderer.calls[0]!.html).not.toContain('https://cdn.thirdparty.com/photo.jpg');
  });
});
