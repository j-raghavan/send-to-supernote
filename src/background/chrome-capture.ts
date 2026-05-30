/**
 * ChromeCapture + ChromeFullPageDriver (FP2-FR2, FP3-FR1/FR3/FR5) — the platform
 * (chrome/DOM) glue behind the `CapturePort` and `FullPageDriver` seams the pure
 * `captureFullPage` orchestrator drives.
 *
 * `ChromeCapture` wraps `api.tabs.get(tabId).windowId` + `captureVisibleTab(…,
 * { format: 'png' })` (gated by `activeTab`); the returned data URL is decoded to
 * raw PNG bytes. `ChromeFullPageDriver` injects self-contained `executeScript`
 * funcs to measure geometry, neutralize fixed/sticky elements (FP2-FR2, recording
 * the originals for restore), scroll, and restore — plus a keep-alive so the
 * event page / service worker is not idle-unloaded mid-capture (FP3-FR5).
 *
 * Every `executeScript` `func` is serialized into the PAGE, so it must be fully
 * self-contained — no bundled import is visible there (same MV3 constraint as
 * `ScriptingExtractor`). All decisions (scroll order, retry, cap, timeout) live
 * in the orchestrator; this file is pure DOM/chrome glue, hence coverage-excluded.
 */
/* c8 ignore start */
import type { CapturePort } from '@shared/ports';
import type { StitchGeometry } from '@conversion/fullpage-stitch-core';
import type { PageSize } from '@domain/conversion';
import type { FullPageDriver } from '@capture/capture-fullpage';
import { api } from '@shared/browser-api';

/**
 * Decode a `data:` URL (as returned by `captureVisibleTab`) into raw bytes.
 * The payload is base64 after the comma; `atob` → byte array. Kept tiny and
 * dependency-free so it works in the service-worker/event-page context.
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class ChromeCapture implements CapturePort {
  async windowIdOf(tabId: number): Promise<number> {
    const tab = await api.tabs.get(tabId);
    return tab.windowId;
  }

  async captureViewport(windowId: number): Promise<Uint8Array> {
    const dataUrl = await api.tabs.captureVisibleTab(windowId, { format: 'png' });
    return dataUrlToBytes(dataUrl);
  }
}

/** Short settle so lazy-load images / sticky reflow land before a capture. */
const SETTLE_MS = 120;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Platform side of the full-page capture orchestrator. One instance per run; it
 * owns the injected DOM mutations and the keep-alive lifetime, both torn down in
 * `dispose()` (called from the orchestrator's `finally`, FP2-FR4 / FP3-FR5).
 */
export class ChromeFullPageDriver implements FullPageDriver {
  /** Long-lived keep-alive timer; cleared in `dispose()` (FP3-FR5). */
  private keepAlive: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly tabId: number,
    private readonly pageSize: PageSize,
  ) {}

  /**
   * Inject + read scrollHeight/innerHeight/dpr/width (FP2-FR3), neutralize
   * fixed/sticky elements recording their originals (FP2-FR2), then combine with
   * the settings-supplied `pageSize` into a `StitchGeometry`.
   */
  async measure(): Promise<StitchGeometry> {
    this.startKeepAlive();
    const measured = await this.run(() => {
      // FP2-FR2 — neutralize fixed/sticky so they do not repeat in every tile;
      // record the originals on the element so restore() can put them back.
      const STAMP = 'data-sts-fp-original';
      const all = document.querySelectorAll<HTMLElement>('*');
      for (const el of Array.from(all)) {
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') {
          if (!el.hasAttribute(STAMP)) {
            el.setAttribute(STAMP, el.style.position || '');
          }
          el.style.position = 'absolute';
        }
      }
      return {
        totalHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        width: window.innerWidth,
        dpr: window.devicePixelRatio,
      };
    });
    return {
      totalHeight: measured.totalHeight,
      viewportHeight: measured.viewportHeight,
      width: measured.width,
      dpr: measured.dpr,
      pageSize: this.pageSize,
    };
  }

  /** Scroll to `y` and return the document's ACTUAL `scrollY` after a settle. */
  async scrollTo(y: number): Promise<number> {
    const actualY = await this.run((targetY) => {
      window.scrollTo(0, targetY);
      return window.scrollY;
    }, y);
    // Let lazy-load images / sticky reflow settle before the next capture.
    await delay(SETTLE_MS);
    return actualY;
  }

  /**
   * Restore scroll position + the neutralized fixed/sticky styles (FP2-FR4), then
   * tear down the keep-alive (FP3-FR5). Best-effort: a closed/navigated tab makes
   * the injection throw, which we swallow — the page is gone, nothing to restore.
   */
  async dispose(): Promise<void> {
    try {
      await this.run(() => {
        const STAMP = 'data-sts-fp-original';
        const stamped = document.querySelectorAll<HTMLElement>(`[${STAMP}]`);
        for (const el of Array.from(stamped)) {
          el.style.position = el.getAttribute(STAMP) ?? '';
          el.removeAttribute(STAMP);
        }
        window.scrollTo(0, 0);
      });
    } catch {
      // Tab closed/navigated — nothing to restore.
    } finally {
      this.stopKeepAlive();
    }
  }

  /**
   * Keep-alive (FP3-FR5): a periodic `api.runtime.getPlatformInfo` ping resets the
   * SW/event-page idle timer for the capture duration. Pragmatic and dependency-
   * free (no extra content connection); cleared in `dispose()`. Manually verified
   * (FP3-AC2), hence coverage-excluded with the rest of this file.
   */
  private startKeepAlive(): void {
    if (this.keepAlive !== undefined) {
      return;
    }
    this.keepAlive = setInterval(() => {
      void api.runtime.getPlatformInfo();
    }, 20_000);
  }

  private stopKeepAlive(): void {
    if (this.keepAlive !== undefined) {
      clearInterval(this.keepAlive);
      this.keepAlive = undefined;
    }
  }

  /** Run a self-contained `func` in the page and return its result (no args). */
  private run<T>(func: () => T): Promise<T>;
  /** Run a self-contained `func` in the page with one serialized arg. */
  private run<T, A>(func: (arg: A) => T, arg: A): Promise<T>;
  private async run<T, A>(func: (arg?: A) => T, arg?: A): Promise<T> {
    const [injection] = await api.scripting.executeScript({
      target: { tabId: this.tabId },
      func,
      ...(arg !== undefined ? { args: [arg] } : {}),
    });
    return injection?.result as T;
  }
}
/* c8 ignore stop */
