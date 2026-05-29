/**
 * OffscreenRenderer (F3/F4) — Renderer port bridging the SW to the offscreen
 * document. THIN glue: ensure the offscreen doc exists (OffscreenManager),
 * post the html + options, and return the RenderedBlob handle the offscreen side
 * stored via IndexedDB (F1-FR6). The render *decisions* live in the covered
 * RenderDocument use case; the actual jsPDF/html2canvas/jszip work is in the
 * offscreen adapters. Coverage-excluded.
 */
/* c8 ignore start */
import type { Renderer, RenderedBlob } from '@shared/ports';
import type { RenderOptions } from '@domain/conversion';
import type { OffscreenManager } from './offscreen-manager';

export interface RenderMessage {
  type: 'render';
  html: string;
  options: RenderOptions;
}

export class OffscreenRenderer implements Renderer {
  constructor(private readonly manager: OffscreenManager) {}

  async render(html: string, options: RenderOptions): Promise<RenderedBlob> {
    const ensured = await this.manager.ensure();
    if (!ensured.ok) {
      throw new Error('Could not create the offscreen renderer.');
    }
    const message: RenderMessage = { type: 'render', html, options };
    const reply: unknown = await chrome.runtime.sendMessage(message);
    await this.manager.release();
    if (reply !== null && typeof reply === 'object' && 'error' in reply) {
      const detail = String(reply.error);
      console.warn('[send-to-supernote] offscreen render error:', detail);
      throw new Error(detail);
    }
    if (reply === undefined || reply === null) {
      throw new Error('Offscreen render returned no result.');
    }
    return reply as RenderedBlob;
  }
}
/* c8 ignore stop */
