import type { Renderer, RenderedBlob } from '@shared/ports';
import type { RenderOptions } from '@domain/conversion';
import { contentTypeFor } from '@domain/conversion';

interface RenderCall {
  html: string;
  options: RenderOptions;
}

/**
 * Canned Renderer. Records render calls and can fail the first N attempts (to
 * exercise the retry-once policy). Returns a deterministic handle/size.
 */
export class FakeRenderer implements Renderer {
  readonly calls: RenderCall[] = [];
  failNext = 0;

  constructor(private readonly size = 1024) {}

  render(html: string, options: RenderOptions): Promise<RenderedBlob> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error('render failed'));
    }
    this.calls.push({ html, options });
    return Promise.resolve({
      handle: `handle-${this.calls.length}`,
      contentType: contentTypeFor(options.format),
      size: this.size,
    });
  }
}
