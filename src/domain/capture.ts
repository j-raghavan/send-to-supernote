/**
 * Capture domain (F3/F4) — pure value types for extracted page content.
 *
 * The two capture modes both yield a `CapturedDocument` (title + HTML) that the
 * conversion context renders to a blob. Reader View adds article metadata. No
 * DOM, no I/O here — the actual DOM extraction lives in the content-script
 * adapters (Extractor port impls); the decisions (empty -> "try Full Page",
 * clone-only) live in the capture use cases.
 */

export type CaptureMode = 'reader' | 'fullpage';

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

/** Raw result of serializing the rendered page for Full Page (F4-FR2). */
export interface FullPageExtract {
  title: string;
  /** Serialized rendered DOM + inlined relevant styles. */
  html: string;
}

/** Normalized captured document handed to the conversion context. */
export interface CapturedDocument {
  mode: CaptureMode;
  title: string;
  html: string;
  byline?: string;
}

/**
 * True when a Reader extract did not yield a usable article (F3-FR5): no body
 * content or a length below a small floor. Used to surface "try Full Page"
 * instead of producing an empty document.
 */
const MIN_ARTICLE_LENGTH = 50;

export function isEmptyReaderExtract(extract: ReaderExtract): boolean {
  const hasContent = extract.content.trim().length > 0;
  return !hasContent || extract.length < MIN_ARTICLE_LENGTH;
}
