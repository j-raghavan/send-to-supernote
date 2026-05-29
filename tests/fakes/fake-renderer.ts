import type { BlobTransfer, Renderer, RenderedBlob } from '@shared/ports';
import type { RenderOptions } from '@domain/conversion';
import { contentTypeFor } from '@domain/conversion';

interface RenderCall {
  html: string;
  options: RenderOptions;
}

/**
 * Canned Renderer. Records render calls and can fail the first N attempts (to
 * exercise the retry-once policy). When a BlobTransfer is provided it stores
 * canned bytes and returns the matching handle — mirroring the real offscreen
 * renderer so the saga can read the bytes back (F1-FR6).
 */
export class FakeRenderer implements Renderer {
  readonly calls: RenderCall[] = [];
  failNext = 0;

  constructor(
    private readonly size = 1024,
    private readonly blobs?: BlobTransfer,
  ) {}

  async render(html: string, options: RenderOptions): Promise<RenderedBlob> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('render failed');
    }
    this.calls.push({ html, options });
    const contentType = contentTypeFor(options.format);
    const bytes = new Uint8Array(this.size).map((_v, i) => i % 256);
    const handle = this.blobs
      ? await this.blobs.put(bytes, contentType)
      : `handle-${this.calls.length}`;
    return { handle, contentType, size: this.size };
  }
}
