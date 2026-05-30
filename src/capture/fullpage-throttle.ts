/**
 * Full Page capture throttle (FP3-FR2/FR3) — pure constants + selector, no DOM,
 * no chrome.
 *
 * `captureVisibleTab` is rate-limited: Chrome documents a ~2 captures/sec quota
 * (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND — a Chrome runtime constant, not in
 * this codebase, and not guaranteed on Firefox). We therefore throttle with a
 * fixed inter-capture delay per target and retry a failed tile once before
 * failing the job (no partial silent upload).
 */

/**
 * Inter-capture delay for the Chrome service worker. The documented quota is
 * ~2 captures/sec → a 500 ms floor keeps every capture within budget.
 */
export const CHROME_CAPTURE_DELAY_MS = 500;

/**
 * Inter-capture delay for the Firefox event page. The Firefox quota is
 * undocumented, so a conservative fixed delay is used (tuned after measuring).
 */
export const FIREFOX_CAPTURE_DELAY_MS = 600;

/** Retry a failed tile capture once before failing the whole job (FP3-FR3). */
export const MAX_TILE_RETRIES = 1;

/** The per-target inter-capture delay (ms) used to throttle captureVisibleTab. */
export function captureDelayMs(target: 'chrome' | 'firefox'): number {
  return target === 'firefox' ? FIREFOX_CAPTURE_DELAY_MS : CHROME_CAPTURE_DELAY_MS;
}
