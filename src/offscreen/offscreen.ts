/**
 * Offscreen document host (F1-FR5/FR6, ADR-0005/0006) — THIN render dispatcher.
 *
 * Receives a render request from the service worker (the only API here is
 * `chrome.runtime`), routes it via the covered `renderRoute` to the pdf / epub /
 * canvas adapters, stores the resulting bytes in IndexedDB via the BlobTransfer
 * port, and returns a RenderedBlob handle (F1-FR6). It does NO auth/upload/job
 * work. Coverage-excluded (architecture §9.3): real-DOM rendering + IndexedDB.
 */
/* c8 ignore start */
import { renderRoute } from '@conversion/render-route';
import { contentTypeFor } from '@domain/conversion';
import { type ReaderExtract, isEmptyReaderExtract } from '@domain/capture';
import type { RenderedBlob } from '@shared/ports';
import { IndexedDbBlobTransfer } from '../background/blob-transfer';
import { renderHtmlToPdf } from './pdf-renderer';
import { renderEpub } from './epub-renderer';
import { extractReaderFromDocument } from '../content/reader';
import type { RenderMessage } from '../background/offscreen-renderer';
import type { ReaderExtractMessage } from '../background/offscreen-reader';

const blobs = new IndexedDbBlobTransfer();

/** Derive a title for EPUB from the HTML (first <h1> or document title). */
function titleFromHtml(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const h1 = container.querySelector('h1');
  return h1?.textContent?.trim() ?? document.title ?? 'Document';
}

async function renderBytes(message: RenderMessage): Promise<Uint8Array> {
  if (renderRoute(message.options) === 'epub') {
    return renderEpub({
      title: titleFromHtml(message.html),
      bodyHtml: message.html,
      identifier: `urn:uuid:${crypto.randomUUID()}`,
    });
  }
  return renderHtmlToPdf(message.html, message.options.pageSize);
}

async function handleRender(message: RenderMessage): Promise<RenderedBlob> {
  const bytes = await renderBytes(message);
  const contentType = contentTypeFor(message.options.format);
  const handle = await blobs.put(bytes, contentType);
  return { handle, contentType, size: bytes.byteLength };
}

/**
 * Parse the page's raw HTML into a Document and run Readability here (the page
 * couldn't — Readability isn't in its context). A <base> makes relative
 * links/images resolve against the original URL.
 */
function handleExtractReader(message: ReaderExtractMessage): ReaderExtract {
  const doc = new DOMParser().parseFromString(message.html, 'text/html');
  const base = doc.createElement('base');
  base.href = message.url;
  doc.head?.prepend(base);

  const article = extractReaderFromDocument(doc);
  if (!isEmptyReaderExtract(article)) {
    return article;
  }

  // Readability found no clean article (docs sites, apps, link-heavy pages).
  // Fall back to the page body (minus scripts/styles/embeds) so the one-tap send
  // still produces a readable document instead of dead-ending.
  const body = doc.body?.cloneNode(true) as HTMLElement | null;
  body?.querySelectorAll('script, style, noscript, iframe, svg, link').forEach((el) => el.remove());
  const text = body?.textContent ?? '';
  return { title: doc.title || 'Page', content: body?.innerHTML ?? '', length: text.trim().length };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  const type = (message as { type?: string }).type;
  if (type === 'render') {
    handleRender(message as RenderMessage)
      .then(sendResponse)
      .catch((thrown: unknown) =>
        // Surface the real render error instead of swallowing it as a generic
        // "Could not render" — the SW logs whatever lands here.
        sendResponse({ error: thrown instanceof Error ? thrown.message : String(thrown) }),
      );
    return true; // keep the message channel open for the async response
  }
  if (type === 'extract-reader') {
    try {
      sendResponse(handleExtractReader(message as ReaderExtractMessage));
    } catch {
      sendResponse(undefined);
    }
    return false; // responded synchronously
  }
  return undefined;
});
/* c8 ignore stop */
