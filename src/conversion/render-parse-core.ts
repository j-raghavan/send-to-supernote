/**
 * Render & reader-parse core (FF2-FR7, I-F7, ADR-FIREFOX-PORT D2/D7) — the SINGLE
 * home for the render-to-bytes and reader-parse logic that used to live inside
 * the Chrome offscreen dispatcher (`offscreen.ts`).
 *
 * Messaging-free and storage-free by design: it depends only on DOM globals
 * (`document`, `DOMParser`, `crypto.randomUUID`) plus the existing conversion /
 * capture cores. It runs unmodified in the Chrome offscreen DOM and the Firefox
 * event-page DOM, and is happy-dom unit-testable. It contains NO `chrome.*` /
 * `@shared/browser-api` reference (I-F1 / FF1-AC3 — `conversion` may use DOM,
 * just not the extension namespace), and NO IndexedDB (storage stays in the
 * adapters — ADR D2). The offscreen dispatcher and both Firefox direct adapters
 * (`DirectRenderer`, `DirectReaderParser`) delegate here — exactly one
 * implementation, two-plus callers (DRY — FF2-AC5).
 */
import { renderRoute } from '@conversion/render-route';
import type { RenderOptions } from '@domain/conversion';
import { type ReaderExtract, isEmptyReaderExtract } from '@domain/capture';
import { extractReaderFromDocument } from '../content/reader';
import { renderHtmlToPdf } from '../offscreen/pdf-renderer';
import { renderEpub } from '../offscreen/epub-renderer';
import { toXhtml } from './html-to-xhtml';
import { stripRemoteImages } from './strip-remote-images';
import { stripImages } from './strip-images';
import { stripHeadElements } from './strip-head-elements';

/**
 * Derive an EPUB title from the content's first <h1>, else the generic
 * 'Document'. It deliberately does NOT consult the render context's
 * `document.title` — in the offscreen doc / event page that is the renderer's
 * own page title ("Send to Supernote — Offscreen Renderer"), which must never
 * leak into the output. The real title is plumbed via `RenderOptions.title`
 * (see `renderToBytes`); this is only the no-title fallback.
 */
export function titleFromHtml(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const heading = container.querySelector('h1')?.textContent?.trim();
  return heading && heading.length > 0 ? heading : 'Document';
}

/**
 * Render captured HTML to PDF/EPUB bytes via the pure `renderRoute` decision:
 * EPUB goes through the jszip builder (titled from the captured document's real
 * title when available, else derived from the content), with a fresh `urn:uuid`
 * identifier; everything else lays the HTML out as a jsPDF PDF.
 */
export async function renderToBytes(html: string, options: RenderOptions): Promise<Uint8Array> {
  // Per-send "Include images" off: strip every image (data: AND remote) before
  // rendering so the text-only choice is enforced authoritatively at render time,
  // independent of whatever the in-page capture inlined. Strict `=== false` so an
  // older caller that omits the field keeps the images-on behavior.
  const source = options.includeImages === false ? stripImages(html) : html;
  if (renderRoute(options) === 'epub') {
    const provided = options.title?.trim();
    return renderEpub({
      title: provided && provided.length > 0 ? provided : titleFromHtml(source),
      // EPUB chapters are parsed as strict XHTML and must be self-contained.
      // Drop remote `<img>` references (undeclared remote resources that an
      // offline reader halts on, truncating the chapter) AND head-only elements
      // left in the body (a stray `<meta>` halts MuPDF 1.17 — the Supernote's
      // EPUB engine — dropping the rest of the article), THEN normalize to
      // well-formed XHTML (self-closed void elements) so a strict reader renders
      // the whole document instead of stopping at the first image or meta tag.
      bodyHtml: toXhtml(stripHeadElements(stripRemoteImages(source))),
      identifier: `urn:uuid:${crypto.randomUUID()}`,
    });
  }
  return renderHtmlToPdf(source, options.pageSize);
}

/**
 * Parse the page's raw HTML into a Document and run Readability here (the page
 * couldn't — Readability isn't in its context). A <base> makes relative
 * links/images resolve against the original URL.
 */
export function parseReader(html: string, url: string): ReaderExtract {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = url;
  doc.head?.prepend(base);

  const article = extractReaderFromDocument(doc);
  if (!isEmptyReaderExtract(article)) {
    return article;
  }

  // Readability found no clean article (docs sites, apps, link-heavy pages).
  // Fall back to the page body (minus scripts/styles/embeds) so the one-tap send
  // still produces a readable document instead of dead-ending. A `text/html`
  // DOMParser result always has a <body>, so no null-guard is needed here.
  const body = doc.body.cloneNode(true) as HTMLElement;
  body.querySelectorAll('script, style, noscript, iframe, svg, link').forEach((el) => el.remove());
  // `Node.textContent` is typed `string | null`, but on an element it is always a
  // string — the `?? ''` is a TS-only guard, never taken at runtime.
  /* c8 ignore next */
  const text = body.textContent ?? '';
  return { title: doc.title || 'Page', content: body.innerHTML, length: text.trim().length };
}
