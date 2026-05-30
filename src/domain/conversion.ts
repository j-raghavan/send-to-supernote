/**
 * Conversion domain (F3/F4) — pure value types and option resolution for
 * rendering captured HTML to a PDF/EPUB blob.
 *
 * No DOM, no jsPDF/html2canvas here: the render *decisions* (page size,
 * pagination, content type) live here and in the RenderDocument use case; the
 * actual DOM-bound rendering is the offscreen adapter behind the Renderer port.
 */
import type { OutputFormat } from '@shared/filename';

export type { OutputFormat } from '@shared/filename';

/** Page geometry for paginated PDF output (F3-FR2). */
export type PageSize = 'a4' | 'letter';

export interface RenderOptions {
  format: OutputFormat;
  /** Page size for PDF pagination (ignored for reflowable EPUB). */
  pageSize: PageSize;
  /** Paginate long content across multiple pages (F3-FR2). */
  paginate: boolean;
  /**
   * The captured document's real title, used as the EPUB heading/metadata. When
   * absent, the renderer derives one from the content — it must NEVER fall back
   * to the render context's own `document.title` (that would leak the offscreen/
   * event-page page title, e.g. "Send to Supernote — Offscreen Renderer", into
   * the output).
   */
  title?: string;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  format: 'pdf',
  pageSize: 'a4',
  paginate: true,
};

/** The MIME content type to associate with the rendered blob. */
export function contentTypeFor(format: OutputFormat): string {
  return format === 'epub' ? 'application/epub+zip' : 'application/pdf';
}

/**
 * Resolve render options from the chosen format and page size. EPUB is
 * reflowable, so pagination is a no-op for it; PDF lays out the captured HTML
 * directly (Reader article or page-body fallback).
 */
export function resolveRenderOptions(
  format: OutputFormat,
  pageSize: PageSize = DEFAULT_RENDER_OPTIONS.pageSize,
): RenderOptions {
  return {
    format,
    pageSize,
    paginate: format === 'pdf',
  };
}
