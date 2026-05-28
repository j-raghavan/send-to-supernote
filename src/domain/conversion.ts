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

/** Page geometry for paginated PDF output (F3-FR2 / F4-FR2). */
export type PageSize = 'a4' | 'letter';

export interface RenderOptions {
  format: OutputFormat;
  /** Page size for PDF pagination (ignored for reflowable EPUB). */
  pageSize: PageSize;
  /** Paginate long content across multiple pages (F3-FR2). */
  paginate: boolean;
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
 * Resolve render options from the chosen format + page size, defaulting
 * sensibly. EPUB is reflowable, so pagination is a no-op for it.
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
