/**
 * Ports — the testability seam (architecture §5, ADR-0001).
 *
 * Domain-owned interfaces. Use cases depend on these; the real `chrome.*` /
 * `fetch` / DOM adapters implement them in `src/background`, `src/content`,
 * `src/offscreen`. Tests inject fakes. No `chrome.*` or `fetch` type leaks into
 * the domain beyond these declarations.
 *
 * Ports are added here as the FRs that need them are implemented; this file is
 * the single home for all of them.
 */

/** Reasons the offscreen document may be created (subset we use). */
export type OffscreenReason = 'DOM_PARSER' | 'BLOBS' | 'IFRAME_SCRIPTING';

/**
 * Thin wrapper over `chrome.offscreen` (+ the existence probe). The real
 * adapter performs the raw API calls with no branching; the single-instance
 * and retry policy lives in the `OffscreenManager` use case so it is testable.
 */
export interface OffscreenHost {
  /** True if an offscreen document currently exists for this extension. */
  exists(): Promise<boolean>;
  /** Create the (single) offscreen document with the given justification. */
  create(url: string, reasons: OffscreenReason[], justification: string): Promise<void>;
  /** Close the current offscreen document, if any. */
  close(): Promise<void>;
}
