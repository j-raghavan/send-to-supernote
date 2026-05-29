/**
 * Filename-confirm validation (F6-FR4) — covered, pure.
 *
 * When confirmFilename is on, the user may edit the suggested name before upload.
 * Their edited input is sanitized with the same F6-FR3 rules and the correct
 * extension is re-applied, so a hand-typed name can't produce an illegal or
 * extension-less filename. An empty edit falls back to the suggested name. The
 * actual prompt is the thin UI shell; this is the testable normalization.
 */
import { sanitizeBaseName, withExtension } from '@shared/filename';
import type { OutputFormat } from '@domain/conversion';

/** Strip a trailing .pdf/.epub the user may have typed, returning the base. */
function stripExtension(name: string, format: OutputFormat): string {
  const suffix = `.${format}`;
  return name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/**
 * Normalize a user-edited filename: sanitize the base with F6-FR3 rules and
 * re-apply the format extension. Falls back to `suggested` when the edit is
 * empty after sanitization.
 */
export function confirmFilename(edited: string, format: OutputFormat, suggested: string): string {
  const base = sanitizeBaseName(stripExtension(edited, format));
  return base.length > 0 ? withExtension(base, format) : suggested;
}
