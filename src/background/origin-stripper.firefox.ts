/**
 * Origin-strip webRequest fallback (FF3-FR3/FR4/FR5, ADR-FIREFOX-PORT D3) — the
 * Firefox-only fallback for the 403-on-Origin finding.
 *
 * The upload `fetch` to `viewer.supernote.com` returns HTTP 403 when a browser
 * `Origin` header is present (F5-FR1 spike). On Chrome a declarativeNetRequest
 * (DNR) rule strips it; that same `public/dnr-rules.json` carries over as the
 * default on Firefox (handled in FF5). This module is the blocking `webRequest`
 * fallback, used ONLY if the live DNR spike (FF3-FR1) shows DNR is insufficient
 * on Firefox. It is code-complete + unit-tested here but NOT wired (wiring is
 * FF4, gated by the `USE_WEBREQUEST` build constant defaulting to false).
 *
 * Scope mirrors the DNR rule exactly: remove header `origin`, on
 * viewer/cloud.supernote.com, for `xmlhttprequest` only. The S3 PUT to
 * `*.amazonaws.com` is NEVER touched (I-F3). Uses the `api` shim (FF1-FR1).
 */
import { api } from '@shared/browser-api';

/**
 * Pure header transform: case-insensitively removes the `Origin` header,
 * preserving all others. This is the testable core (coverage-eligible).
 */
export function stripOrigin(
  headers: chrome.webRequest.HttpHeader[],
): chrome.webRequest.HttpHeader[] {
  return headers.filter((h) => h.name.toLowerCase() !== 'origin');
}

/**
 * The url/type scope for the listener — mirrors the DNR rule's
 * `requestDomains` + `resourceTypes`, and excludes `*.amazonaws.com` (I-F3).
 */
export const ORIGIN_STRIP_FILTER: chrome.webRequest.RequestFilter = {
  urls: ['https://viewer.supernote.com/*', 'https://cloud.supernote.com/*'],
  types: ['xmlhttprequest'],
};

/* c8 ignore start */
/**
 * Thin registration glue (DOM/runtime). Registers the blocking listener that
 * applies `stripOrigin` to outgoing request headers within the scoped filter.
 * Not wired until FF4. Coverage-excluded (listener-registration adapter).
 */
export function registerOriginStripper(): void {
  api.webRequest.onBeforeSendHeaders.addListener(
    (details) => ({ requestHeaders: stripOrigin(details.requestHeaders ?? []) }),
    ORIGIN_STRIP_FILTER,
    ['blocking', 'requestHeaders'],
  );
}
/* c8 ignore stop */
