/**
 * Offscreen document host (F1-FR5/FR6, ADR-0005/0006) — THIN render dispatcher.
 *
 * Receives a render request from the service worker (the only API here is
 * `chrome.runtime`), delegates the render/parse work to the shared, messaging-free
 * `render-parse-core` (FF2-FR7 / I-F7 — the single home for that logic), stores
 * the resulting bytes in IndexedDB via the BlobTransfer port, and returns a
 * RenderedBlob handle (F1-FR6). It does NO auth/upload/job work and holds NO copy
 * of the render/parse logic (FF2-AC5) — decode → call shared fn → encode only.
 * Coverage-excluded (architecture §9.3): real-DOM rendering + IndexedDB.
 */
/* c8 ignore start */
import { renderToBytes, parseReader } from '@conversion/render-parse-core';
import { contentTypeFor } from '@domain/conversion';
import { DEFAULT_CAP, stitchFullPageToPdf } from '@conversion/fullpage-stitch-core';
import type { ReaderExtract } from '@domain/capture';
import type { RenderedBlob } from '@shared/ports';
import { IndexedDbBlobTransfer } from '../background/blob-transfer';
import type { RenderMessage } from '../background/offscreen-renderer';
import type { ReaderExtractMessage } from '../background/offscreen-reader';
import type { StitchMessage } from '../background/offscreen-stitcher';

const blobs = new IndexedDbBlobTransfer();

async function handleRender(message: RenderMessage): Promise<RenderedBlob> {
  const bytes = await renderToBytes(message.html, message.options);
  const contentType = contentTypeFor(message.options.format);
  const handle = await blobs.put(bytes, contentType);
  return { handle, contentType, size: bytes.byteLength };
}

async function handleStitch(message: StitchMessage): Promise<RenderedBlob> {
  // Tiles arrive as handles (FP3-FR4) — resolve each through the offscreen
  // IndexedDB blob transfer, stitch/paginate via the shared chrome-free core,
  // then store the PDF and hand the SW back a handle (never inline bytes).
  const bytes = await stitchFullPageToPdf(
    message.tiles,
    message.geometry,
    async (handle) => (await blobs.get(handle))?.bytes,
    DEFAULT_CAP,
  );
  const handle = await blobs.put(bytes, 'application/pdf');
  return { handle, contentType: 'application/pdf', size: bytes.byteLength };
}

function handleExtractReader(message: ReaderExtractMessage): ReaderExtract {
  return parseReader(message.html, message.url);
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
  if (type === 'stitch') {
    handleStitch(message as StitchMessage)
      .then(sendResponse)
      .catch((thrown: unknown) =>
        // Surface the real stitch error instead of swallowing it — the SW logs
        // whatever lands here (parity with the render arm above).
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
