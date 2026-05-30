/**
 * DirectStitcher (FP4-FR2, FF4-parity) — the Firefox stitch adapter.
 *
 * Implements the `Stitcher` port by delegating, in-page (the DOM-capable event
 * page), to the shared `stitchFullPageToPdf` from `fullpage-stitch-core` — no
 * offscreen document is created on Firefox (parity with `DirectRenderer` /
 * FF2-FR6). It resolves each tile handle to bytes through the injected
 * `BlobTransfer` (IndexedDB in production), stores the resulting PDF bytes, and
 * returns the `RenderedBlob` handle (FP3-FR4). The stitch/paginate arithmetic
 * lives once in the core (DRY) — this adapter holds no copy of it. On Chrome the
 * equivalent is `OffscreenStitcher`.
 */
import type { BlobTransfer, RenderedBlob, Stitcher } from '@shared/ports';
import {
  DEFAULT_CAP,
  type StitchGeometry,
  stitchFullPageToPdf,
  type TileRef,
} from '@conversion/fullpage-stitch-core';

export class DirectStitcher implements Stitcher {
  constructor(private readonly blobs: BlobTransfer) {}

  async stitch(tiles: TileRef[], geometry: StitchGeometry): Promise<RenderedBlob> {
    const bytes = await stitchFullPageToPdf(
      tiles,
      geometry,
      async (handle) => (await this.blobs.get(handle))?.bytes,
      DEFAULT_CAP,
    );
    const handle = await this.blobs.put(bytes, 'application/pdf');
    return { handle, contentType: 'application/pdf', size: bytes.byteLength };
  }
}
