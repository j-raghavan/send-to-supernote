/**
 * DirectRenderer (FF2-FR1, FF2-FR6, FF2-AC5, I-F7) — the Firefox render adapter.
 *
 * Implements the `Renderer` port by delegating, in-page (the DOM-capable event
 * page), to the shared `renderToBytes` from `render-parse-core` — no offscreen
 * document is created on Firefox (FF2-FR6 / I-F2). It then stores the bytes via
 * the injected `BlobTransfer` (IndexedDB in production) and returns the
 * `RenderedBlob` handle (F1-FR6). Storage stays in the adapter; the render
 * decision/title/EPUB-vs-PDF logic lives once in the core (DRY) — this adapter
 * holds no copy of it. On Chrome the equivalent is `OffscreenRenderer`.
 */
import type { BlobTransfer, Renderer, RenderedBlob } from '@shared/ports';
import { contentTypeFor, type RenderOptions } from '@domain/conversion';
import { renderToBytes } from '@conversion/render-parse-core';

export class DirectRenderer implements Renderer {
  constructor(private readonly blobs: BlobTransfer) {}

  async render(html: string, options: RenderOptions): Promise<RenderedBlob> {
    const bytes = await renderToBytes(html, options);
    const contentType = contentTypeFor(options.format);
    const handle = await this.blobs.put(bytes, contentType);
    return { handle, contentType, size: bytes.byteLength };
  }
}
