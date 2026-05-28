/**
 * Conversion domain (F3/F4) — pure value types and option resolution for
 * rendering captured HTML to a PDF/EPUB blob.
 *
 * No DOM, no jsPDF/html2canvas here: the render *decisions* (page size,
 * pagination, content type) live here and in the RenderDocument use case; the
 * actual DOM-bound rendering is the offscreen adapter behind the Renderer port.
 */
import type { OutputFormat } from '@shared/filename';
import type { CaptureMode } from '@domain/capture';

export type { OutputFormat } from '@shared/filename';

/** Page geometry for paginated PDF output (F3-FR2 / F4-FR2). */
export type PageSize = 'a4' | 'letter';

export interface RenderOptions {
  format: OutputFormat;
  /** Page size for PDF pagination (ignored for reflowable EPUB). */
  pageSize: PageSize;
  /** Paginate long content across multiple pages (F3-FR2). */
  paginate: boolean;
  /**
   * Rasterize via html2canvas before paginating (Full Page best-effort, F4-FR2)
   * vs. lay out HTML directly (Reader). EPUB ignores this (reflowable).
   */
  rasterize: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  format: 'pdf',
  pageSize: 'a4',
  paginate: true,
  rasterize: false,
};

/** The MIME content type to associate with the rendered blob. */
export function contentTypeFor(format: OutputFormat): string {
  return format === 'epub' ? 'application/epub+zip' : 'application/pdf';
}

/**
 * Resolve render options from the chosen format, capture mode, and page size,
 * defaulting sensibly. EPUB is reflowable, so pagination/rasterization are
 * no-ops for it. Full Page PDF rasterizes via html2canvas (F4-FR2); Reader PDF
 * lays out the HTML directly.
 */
export function resolveRenderOptions(
  format: OutputFormat,
  mode: CaptureMode = 'reader',
  pageSize: PageSize = DEFAULT_RENDER_OPTIONS.pageSize,
): RenderOptions {
  const isPdf = format === 'pdf';
  return {
    format,
    pageSize,
    paginate: isPdf,
    rasterize: isPdf && mode === 'fullpage',
  };
}
