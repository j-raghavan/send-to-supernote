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
import type { RenderedBlob } from '@shared/ports';
import { IndexedDbBlobTransfer } from '../background/blob-transfer';
import { renderCanvasToPdf, renderHtmlToPdf } from './pdf-renderer';
import { renderEpub } from './epub-renderer';
import { rasterizeToCanvas } from './canvas-raster';
import type { RenderMessage } from '../background/offscreen-renderer';

const blobs = new IndexedDbBlobTransfer();

/** Derive a title for EPUB from the HTML (first <h1> or document title). */
function titleFromHtml(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const h1 = container.querySelector('h1');
  return h1?.textContent?.trim() ?? document.title ?? 'Document';
}

async function renderBytes(message: RenderMessage): Promise<Uint8Array> {
  const route = renderRoute(message.options);
  if (route === 'epub') {
    return renderEpub({
      title: titleFromHtml(message.html),
      bodyHtml: message.html,
      identifier: `urn:uuid:${crypto.randomUUID()}`,
    });
  }
  if (route === 'pdf-rasterized') {
    const container = document.createElement('div');
    container.innerHTML = message.html;
    document.body.appendChild(container);
    try {
      const canvas = await rasterizeToCanvas(container);
      return renderCanvasToPdf(canvas, message.options.pageSize);
    } finally {
      container.remove();
    }
  }
  return renderHtmlToPdf(message.html, message.options.pageSize);
}

async function handleRender(message: RenderMessage): Promise<RenderedBlob> {
  const bytes = await renderBytes(message);
  const contentType = contentTypeFor(message.options.format);
  const handle = await blobs.put(bytes, contentType);
  return { handle, contentType, size: bytes.byteLength };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  if ((message as { type?: string }).type !== 'render') {
    return undefined;
  }
  handleRender(message as RenderMessage)
    .then(sendResponse)
    .catch(() => sendResponse(undefined));
  return true; // keep the message channel open for the async response
});
/* c8 ignore stop */
