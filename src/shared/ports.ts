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

/**
 * Opaque handle to rendered bytes stored out-of-band (F1-FR6, ADR-0006).
 * Multi-MB blobs are NOT passed through `chrome.runtime.sendMessage` JSON; the
 * offscreen renderer stores the bytes and returns a handle the service worker
 * resolves when it needs the bytes for upload. Persisting via IndexedDB lets a
 * job resume after a service-worker eviction (F9-FR5).
 */
export type BlobHandle = string;

/**
 * Binary-safe blob handoff between the offscreen renderer and the service
 * worker. The real adapter is IndexedDB-backed (`background/blob-transfer.ts`);
 * tests use an in-memory implementation of the same port.
 */
export interface BlobTransfer {
  /** Store bytes and return a handle to them. */
  put(bytes: Uint8Array, contentType: string): Promise<BlobHandle>;
  /** Resolve a handle back to the stored bytes (and their content type). */
  get(handle: BlobHandle): Promise<{ bytes: Uint8Array; contentType: string } | undefined>;
  /** Delete the stored bytes for a handle (after finish or on prune). */
  delete(handle: BlobHandle): Promise<void>;
}

/**
 * Source of non-deterministic values, injected so tests are deterministic.
 * Used for the equipment id and the Private Cloud nonce ({10 digits}{ts}).
 */
export interface RandomSource {
  /** A string of exactly `count` decimal digits. */
  digits(count: number): string;
  /** An RFC-4122 UUID. */
  uuid(): string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface HttpRequest {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  /** JSON-serializable body, raw bytes, or FormData (multipart) — adapter-encoded. */
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  /** Parsed JSON body when the response is JSON; otherwise undefined. */
  json?: unknown;
}

/**
 * The ONLY network seam. The real adapter wraps `fetch` (the sole `fetch` in
 * the codebase); tests inject a fake that returns scripted responses and records
 * every requested URL so destinations can be asserted (D-3 / I-2).
 */
export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Logger seam. The real adapter scrubs known secret-bearing fields before
 * writing to the console; the password is never passed here in the first place
 * (it stays function-local in the login routine — F2-FR2). Tests use a recorder
 * to assert no secret ever appears in a log line (I-1).
 */
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
