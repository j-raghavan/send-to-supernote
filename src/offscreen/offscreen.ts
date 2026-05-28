/**
 * Offscreen document host (F1-FR5/FR6, ADR-0005/0006).
 *
 * Runs DOM-dependent rendering (HTML -> PDF/EPUB) that the service worker
 * cannot. Only `chrome.runtime` is available here; it does pure rendering and
 * returns a blob handle — no auth/upload/job work (F1-FR6). Coverage-excluded
 * host bootstrap (architecture §9.3). Render routing is populated in F3/F4.
 */
export {};
