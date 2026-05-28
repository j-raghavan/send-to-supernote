/**
 * Filename rules (F6-FR3) — pure domain logic, no I/O.
 *
 * Sanitization order (spec F6-FR3):
 *   1. remove illegal/awkward chars: / \ : * ? " < > | and ( ) [ ] { } ' "
 *   2. replace every run of whitespace with a single hyphen
 *   3. collapse consecutive hyphens to one; trim leading/trailing hyphens and dots
 *   4. preserve original letter case (do NOT lowercase)
 *   5. cap the base name to 120 chars (cut on a hyphen boundary where possible)
 *
 * Fallback (empty title): `<hostname>-<YYYY-MM-DD>`.
 * De-duplication: append `-2`, `-3`, … before the extension when the name
 * already exists in the destination folder.
 */

export type OutputFormat = 'pdf' | 'epub';

const MAX_BASE_LENGTH = 120;

/** Characters that are illegal or awkward in filenames, plus bracket/quote punctuation. */
// eslint-disable-next-line no-useless-escape
const ILLEGAL_CHARS = /[\/\\:*?"<>|()\[\]{}'"]/g;
const WHITESPACE_RUN = /\s+/g;
const HYPHEN_RUN = /-+/g;
const TRIM_EDGES = /^[-.]+|[-.]+$/g;

/** The base name (no extension) sanitized per F6-FR3, capped at 120 chars. */
export function sanitizeBaseName(title: string): string {
  const cleaned = title
    .replace(ILLEGAL_CHARS, '')
    .replace(WHITESPACE_RUN, '-')
    .replace(HYPHEN_RUN, '-')
    .replace(TRIM_EDGES, '');
  return capOnHyphen(cleaned, MAX_BASE_LENGTH);
}

/**
 * Cap to `max` chars, preferring to cut on a hyphen boundary so a word is not
 * split mid-token. Falls back to a hard cut if there is no hyphen in range.
 * Trailing hyphens/dots introduced by the cut are trimmed.
 */
function capOnHyphen(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const slice = value.slice(0, max);
  const lastHyphen = slice.lastIndexOf('-');
  const cut = lastHyphen > 0 ? slice.slice(0, lastHyphen) : slice;
  return cut.replace(TRIM_EDGES, '');
}

/** `YYYY-MM-DD` in UTC for the given epoch milliseconds. */
function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Fallback base name from hostname + capture date when the title is empty. */
export function fallbackBaseName(hostname: string, epochMs: number): string {
  const host = hostname.replace(ILLEGAL_CHARS, '').replace(TRIM_EDGES, '') || 'page';
  return `${host}-${isoDate(epochMs)}`;
}

/**
 * Resolve the final base name: sanitized title, or the hostname/date fallback
 * when the sanitized title is empty (F6-AC2/AC2b).
 */
export function resolveBaseName(title: string, hostname: string, epochMs: number): string {
  const sanitized = sanitizeBaseName(title);
  return sanitized.length > 0 ? sanitized : fallbackBaseName(hostname, epochMs);
}

/** Append the format extension to a base name. */
export function withExtension(baseName: string, format: OutputFormat): string {
  return `${baseName}.${format}`;
}

/**
 * De-duplicate a full filename (base + extension) against the names that
 * already exist in the destination folder, appending `-2`, `-3`, … before the
 * extension (F6-FR3 / F6-AC4). Comparison is case-sensitive (case is preserved).
 */
export function dedupeName(
  baseName: string,
  format: OutputFormat,
  existingNames: readonly string[],
): string {
  const existing = new Set(existingNames);
  const first = withExtension(baseName, format);
  if (!existing.has(first)) {
    return first;
  }
  let counter = 2;
  for (;;) {
    const candidate = withExtension(`${baseName}-${counter}`, format);
    if (!existing.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
}

/**
 * Full pipeline: resolve the base name (title or fallback), then de-duplicate
 * against the destination folder's existing names. Returns the upload filename.
 */
export function buildUploadFilename(input: {
  title: string;
  hostname: string;
  epochMs: number;
  format: OutputFormat;
  existingNames: readonly string[];
}): string {
  const base = resolveBaseName(input.title, input.hostname, input.epochMs);
  return dedupeName(base, input.format, input.existingNames);
}
