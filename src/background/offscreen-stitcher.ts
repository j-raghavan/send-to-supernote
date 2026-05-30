/**
 * OffscreenStitcher (FP4-FR2, FP7-FR1) — Stitcher port bridging the SW to the
 * offscreen document. THIN glue mirroring `OffscreenRenderer`: ensure the
 * offscreen doc exists (OffscreenManager), post the ordered tile handles +
 * geometry, and return the `RenderedBlob` the offscreen side stored via
 * IndexedDB (FP3-FR4). The stitch/paginate *logic* lives once in the chrome-free
 * `fullpage-stitch-core`; the tiles cross as HANDLES, never inline PNG bytes
 * (multi-MB payloads cannot ride `runtime.sendMessage`). Coverage-excluded.
 */
/* c8 ignore start */
import type { RenderedBlob, Stitcher } from '@shared/ports';
import type { StitchGeometry, TileRef } from '@conversion/fullpage-stitch-core';
import type { OffscreenManager } from './offscreen-manager';

export interface StitchMessage {
  type: 'stitch';
  tiles: TileRef[];
  geometry: StitchGeometry;
}

export class OffscreenStitcher implements Stitcher {
  constructor(private readonly manager: OffscreenManager) {}

  async stitch(tiles: TileRef[], geometry: StitchGeometry): Promise<RenderedBlob> {
    const ensured = await this.manager.ensure();
    if (!ensured.ok) {
      throw new Error('Could not create the offscreen stitcher.');
    }
    const message: StitchMessage = { type: 'stitch', tiles, geometry };
    const reply: unknown = await chrome.runtime.sendMessage(message);
    await this.manager.release();
    if (reply !== null && typeof reply === 'object' && 'error' in reply) {
      const detail = String(reply.error);
      console.warn('[send-to-supernote] offscreen stitch error:', detail);
      throw new Error(detail);
    }
    if (reply === undefined || reply === null) {
      throw new Error('Offscreen stitch returned no result.');
    }
    return reply as RenderedBlob;
  }
}
/* c8 ignore stop */
