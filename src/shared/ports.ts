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
import type { ReaderExtract } from '@domain/capture';
import type { RenderOptions } from '@domain/conversion';
import type { StitchGeometry, TileRef } from '@conversion/fullpage-stitch-core';

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
  /**
   * Download raw bytes (e.g. a PDF the user is already viewing, sent as-is).
   * `bytes` is absent on a non-OK status. Kept on this port so all network still
   * flows through the single seam (I-2/D-3).
   */
  getBytes(url: string): Promise<{ status: number; bytes?: Uint8Array }>;
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

/**
 * Key-value persistence. The real adapter is backed by `chrome.storage.local`
 * ONLY — never `chrome.storage.sync` (I-5/D-2: secrets must not propagate across
 * machines). Tests use an in-memory map implementing the same port.
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  /** All currently-stored keys (used by Disconnect to clear by prefix). */
  keys(): Promise<string[]>;
}

export type NotifyLevel = 'progress' | 'success' | 'error';

export interface Notification {
  level: NotifyLevel;
  title: string;
  message: string;
}

/** User-facing notifications (F6-FR5). Real adapter wraps `chrome.notifications`. */
export interface Notifier {
  notify(notification: Notification): Promise<void>;
}

/** Opens the extension's Options page, optionally prefilling an account (F2-FR4). */
export interface OptionsOpener {
  open(prefillAccount?: string): Promise<void>;
}

/** Toolbar badge visual states (F2-FR6 / F6-FR5). */
export type BadgeState = 'idle' | 'busy' | 'error' | 'expired';

/** Sets the toolbar action badge. Real adapter wraps `chrome.action`. */
export interface Badge {
  set(state: BadgeState): Promise<void>;
}

/** Wall-clock source, injected so time-dependent logic (filename date, TTL) is deterministic. */
export interface Clock {
  now(): number;
}

/**
 * Page-content extraction (F3). The real adapter captures the page's rendered
 * HTML (I-4: never mutating the live page) and runs Readability off-page. Tests
 * inject canned extracts so the capture use cases are pure-testable.
 */
export interface Extractor {
  /** Extract the readable article from the active tab (F3-FR1). */
  extractReader(): Promise<ReaderExtract>;
}

/** Result of a render: a handle to the stored blob plus its byte size. */
export interface RenderedBlob {
  handle: BlobHandle;
  contentType: string;
  size: number;
}

/**
 * Render captured HTML to a PDF/EPUB blob (F3-FR2/FR3, F4-FR2). The real adapter
 * runs in the offscreen document (jsPDF/html2canvas/jszip), stores the bytes via
 * BlobTransfer, and returns a handle (F1-FR6). Tests inject a fake returning a
 * canned handle so the conversion use case is pure-testable.
 */
export interface Renderer {
  render(html: string, options: RenderOptions): Promise<RenderedBlob>;
}

/**
 * Viewport screenshot of the active tab (FP3-FR1), gated by `activeTab` (granted
 * by the send click — no broad host permission). The real adapter wraps
 * `api.tabs.get(tabId).windowId` + `api.tabs.captureVisibleTab(windowId,
 * { format: 'png' })` with no branching; the scroll/throttle/retry policy lives
 * in the `captureFullPage` orchestrator so it is testable. Tests inject a fake
 * returning a scripted window id and canned PNG bytes per call.
 */
export interface CapturePort {
  /** Resolve the tab's window id via `api.tabs.get(tabId).windowId` (FP3-FR1). */
  windowIdOf(tabId: number): Promise<number>;
  /** Capture the visible viewport of `windowId` as PNG bytes (FP3-FR1). */
  captureViewport(windowId: number): Promise<Uint8Array>;
}

/**
 * Stitch + paginate captured tiles into a rendered blob (FP4-FR2/FR4). Target-
 * gated like the render path: an offscreen-document dispatch on Chrome vs a
 * `DirectStitcher` on Firefox, both delegating to the chrome-free
 * `stitchFullPageToPdf` core. Returns a `RenderedBlob` handle (FP3-FR4), never
 * inline bytes over `runtime.sendMessage`.
 */
export interface Stitcher {
  stitch(tiles: TileRef[], geometry: StitchGeometry): Promise<RenderedBlob>;
}

/**
 * Runtime host-permission grant for a user-configured origin (F8-FR1). The
 * Private Cloud base URL is not a static host permission, so access is requested
 * at save time via chrome.permissions. Real adapter wraps chrome.permissions;
 * tests inject a grant/deny toggle.
 */
export interface PermissionGranter {
  /** Request host access for an origin (e.g. "http://192.168.x.x:8080/*"). Returns whether granted. */
  request(origin: string): Promise<boolean>;
}

/**
 * Reads browser cookies for a URL. Used by the Supernote-Cloud connect flow to
 * pick up the `x-access-token` session cookie the official login page sets
 * (sign-in is CAPTCHA/2FA-gated, so the extension never logs in itself). Real
 * adapter wraps `chrome.cookies`; tests inject scripted cookie values.
 */
export interface CookieReader {
  /** The value of cookie `name` for `url`, or undefined when absent. */
  get(url: string, name: string): Promise<string | undefined>;
}

/**
 * Opens/closes browser tabs for the connect flow (open the official login page,
 * close it once the session cookie is captured). Real adapter wraps
 * `chrome.tabs`; tests inject a recorder.
 */
export interface TabController {
  /** Open a new tab at `url`; resolves to the created tab id (when known). */
  open(url: string): Promise<number | undefined>;
  /** Close the tab with the given id (no-op if already gone). */
  close(tabId: number): Promise<void>;
}
