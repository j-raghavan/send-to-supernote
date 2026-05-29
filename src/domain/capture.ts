/**
 * Capture domain (F3) — pure value types for extracted page content.
 *
 * Capture yields a `CapturedDocument` (title + HTML) that the conversion context
 * renders to a blob. No DOM, no I/O here — the actual DOM extraction lives in
 * the content-script / offscreen adapters (Extractor port impls); the decisions
 * (empty-content guard, clone-only) live in the capture use cases.
 */

/** Capture mode. Reader extraction is the only mode (Full Page was removed). */
export type CaptureMode = 'reader';

/** Raw result of running Readability on a document clone (F3-FR1). */
export interface ReaderExtract {
  title: string;
  byline?: string;
  /** Article body as HTML. */
  content: string;
  excerpt?: string;
  /** Approximate text length; 0/short signals a failed extraction (F3-FR5). */
  length: number;
}

/** Normalized captured document handed to the conversion context. */
export interface CapturedDocument {
  mode: CaptureMode;
  title: string;
  html: string;
  byline?: string;
}

/**
 * True when a Reader extract did not yield usable content (F3-FR5): no body
 * content or a length below a small floor. Used to surface a clear error
 * instead of producing an empty document.
 */
const MIN_ARTICLE_LENGTH = 50;

export function isEmptyReaderExtract(extract: ReaderExtract): boolean {
  const hasContent = extract.content.trim().length > 0;
  return !hasContent || extract.length < MIN_ARTICLE_LENGTH;
}
