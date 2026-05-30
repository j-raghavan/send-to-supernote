/**
 * Full Page capture orchestrator (FP2-FR3, FP3-FR3/FR4, FP6-FR1/FR2/FR3) — the
 * PURE control logic that drives one full-page capture run.
 *
 * It owns every decision branch (scroll order, throttle, retry-once, page/height
 * cap, timeout, non-scroll fallback, restore-always) but touches NO `chrome.*`
 * and NO DOM directly: the platform is reached only through the injected
 * `FullPageDriver` (inject/scroll/restore) and `CapturePort` (windowId +
 * screenshot) seams, both faked in tests. The real DOM/chrome glue behind those
 * seams is the c8-ignored Batch-E adapter; this orchestrator is 100%-coverable
 * with fakes (mirrors `renderDocument`'s "decisions here, glue behind the port"
 * split).
 *
 * Tiles are carried forward as `{ handle, offsetY }` only — full-viewport PNG
 * bytes are stored via `BlobTransfer` and never forwarded inline (FP3-FR4).
 */
import { captureDelayMs, MAX_TILE_RETRIES } from '@capture/fullpage-throttle';
import { hasScrollProgress, planScrollOffsets } from '@capture/fullpage-plan';
import {
  DEFAULT_CAP,
  type FullPageCap,
  type StitchGeometry,
  type TileRef,
} from '@conversion/fullpage-stitch-core';
import type { BlobTransfer, CapturePort, Clock } from '@shared/ports';
import { err, ok, type Result } from '@shared/result';

/**
 * Drives the platform side of one capture run: inject the scroll orchestrator,
 * measure the page, scroll, and restore. The real implementation is the
 * c8-ignored DOM/chrome glue (Batch E); tests inject a fake.
 */
export interface FullPageDriver {
  /** Inject + read scrollHeight/innerHeight/dpr/width/pageSize (FP2-FR3). */
  measure(): Promise<StitchGeometry>;
  /** Scroll to `y` and return the document's ACTUAL `scrollY` after (FP6-FR3). */
  scrollTo(y: number): Promise<number>;
  /** Restore page (scroll + styles) + tear down keep-alive, ALWAYS (FP2-FR4). */
  dispose(): Promise<void>;
}

export interface FullPageCaptureDeps {
  tabId: number;
  capture: CapturePort;
  blobs: BlobTransfer;
  driver: FullPageDriver;
  target: 'chrome' | 'firefox';
  clock: Clock;
  /** Injected so the inter-capture throttle is deterministic in tests. */
  sleep: (ms: number) => Promise<void>;
  /** Page/height cap (FP6-FR1); defaults to `DEFAULT_CAP`. */
  cap?: FullPageCap;
  /** Whole-run upper bound in ms (FP6-FR2); unbounded when absent. */
  timeoutMs?: number;
}

export interface FullPageResult {
  tiles: TileRef[];
  geometry: StitchGeometry;
  /** True when the page cap stopped the run early (FP6-FR1). */
  truncated: boolean;
}

export type FullPageError = {
  kind: 'capture-failed' | 'capture-timeout';
  message: string;
};

/**
 * Run the capture loop and return ordered tile handles + geometry. Restores the
 * page in a `finally` no matter how the run ends (success, cap, timeout, error —
 * FP2-FR4/IP-1). Expected failures are returned as a `Result`, not thrown.
 */
export async function captureFullPage(
  deps: FullPageCaptureDeps,
): Promise<Result<FullPageResult, FullPageError>> {
  const { capture, blobs, driver, target, clock, sleep } = deps;
  const cap = deps.cap ?? DEFAULT_CAP;
  const delayMs = captureDelayMs(target);

  // Hoisted so the `finally` can free the stored tile blobs on ANY non-success
  // exit (error return, timeout, or throw). On success the tiles are handed to
  // the stitcher, which frees them after paginating — so we only clean up here
  // when the run did NOT hand them off (prevents orphaned IndexedDB blobs).
  const tiles: TileRef[] = [];
  let handedOff = false;

  try {
    const windowId = await capture.windowIdOf(deps.tabId);
    const geometry = await driver.measure();
    const offsets = planScrollOffsets(geometry);
    const start = clock.now();

    let truncated = false;
    let prevY = 0;

    for (let i = 0; i < offsets.length; i += 1) {
      // FP6-FR2 — whole-run timeout: fail cleanly (page restored in finally).
      if (deps.timeoutMs !== undefined && clock.now() - start > deps.timeoutMs) {
        return err({
          kind: 'capture-timeout',
          message: 'Full-page capture timed out. Please try again.',
        });
      }

      // FP6-FR1 — page cap: stop before capturing more; flag truncation.
      if (i >= cap.maxPages) {
        truncated = true;
        break;
      }

      const offset = offsets[i]!;
      const actualY = await driver.scrollTo(offset);

      // FP6-FR3 — non-scroll fallback: the document did not move (SPA/inner
      // scroll). Keep the tiles captured so far rather than looping.
      if (i > 0 && !hasScrollProgress(prevY, actualY)) {
        break;
      }

      // FP3-FR2 — throttle captureVisibleTab to stay within the per-second quota.
      await sleep(delayMs);

      // FP3-FR3 — capture with retry-once; persistent failure fails the job.
      const bytes = await captureWithRetry(capture, windowId);
      if (bytes === undefined) {
        return err({
          kind: 'capture-failed',
          message: 'Could not capture the page. Please try again.',
        });
      }

      // FP3-FR4 — store bytes out-of-band; carry only the handle + offset.
      const handle = await blobs.put(bytes, 'image/png');
      tiles.push({ handle, offsetY: offset });
      prevY = actualY;
    }

    handedOff = true;
    return ok({ tiles, geometry, truncated });
  } finally {
    // FP2-FR4 / IP-1 — restore page + release keep-alive ALWAYS.
    await driver.dispose();
    // Free any tiles we stored but are NOT returning (error/timeout/throw), so a
    // failed capture leaves no orphaned blobs in IndexedDB.
    if (!handedOff) {
      await releaseTiles(blobs, tiles);
    }
  }
}

/** Best-effort delete of stored tile blobs; never throws (runs in `finally`). */
async function releaseTiles(blobs: BlobTransfer, tiles: TileRef[]): Promise<void> {
  for (const tile of tiles) {
    try {
      await blobs.delete(tile.handle);
    } catch {
      // Best-effort cleanup — a failed delete must not mask the original outcome.
    }
  }
}

/**
 * Capture one viewport, retrying up to `MAX_TILE_RETRIES` times on throw
 * (FP3-FR3). Returns the bytes on success or `undefined` once all attempts are
 * exhausted, so the orchestrator can fail the job without a partial upload.
 */
async function captureWithRetry(
  capture: CapturePort,
  windowId: number,
): Promise<Uint8Array | undefined> {
  for (let attempt = 0; attempt <= MAX_TILE_RETRIES; attempt += 1) {
    try {
      return await capture.captureViewport(windowId);
    } catch {
      // Fall through to retry; exhausting the loop returns undefined below.
    }
  }
  return undefined;
}
