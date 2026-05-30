import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureFullPage, type FullPageCaptureDeps } from '../../../src/capture/capture-fullpage';
import {
  CHROME_CAPTURE_DELAY_MS,
  FIREFOX_CAPTURE_DELAY_MS,
} from '../../../src/capture/fullpage-throttle';
import type { FullPageCap, StitchGeometry } from '../../../src/conversion/fullpage-stitch-core';
import { InMemoryBlobTransfer } from '../../../src/background/in-memory-blob-transfer';
import { FakeCapturePort } from '../../fakes/fake-capture-port';
import { FakeClock } from '../../fakes/fake-clock';
import { FakeFullPageDriver } from '../../fakes/fake-fullpage-driver';
import { FakeRandomSource } from '../../fakes/fake-random-source';

const TAB_ID = 42;
const WINDOW_ID = 7;

/**
 * Geometry whose totalHeight/viewportHeight yields exactly three scroll offsets:
 * total 2400, vh 800 → planScrollOffsets = [0, 800, 1600].
 */
function geometry(totalHeight = 2400, viewportHeight = 800): StitchGeometry {
  return { totalHeight, viewportHeight, width: 1280, dpr: 1, pageSize: 'a4' };
}

interface Harness {
  deps: FullPageCaptureDeps;
  capture: FakeCapturePort;
  blobs: InMemoryBlobTransfer;
  driver: FakeFullPageDriver;
  clock: FakeClock;
  sleep: ReturnType<typeof vi.fn>;
}

function harness(
  overrides: {
    geo?: StitchGeometry;
    scrollResult?: (y: number) => number;
    target?: 'chrome' | 'firefox';
    cap?: FullPageCap;
    timeoutMs?: number;
    failNext?: number;
    clock?: FakeClock;
  } = {},
): Harness {
  const capture = new FakeCapturePort(WINDOW_ID);
  if (overrides.failNext) {
    capture.failNext = overrides.failNext;
  }
  const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
  const driver = new FakeFullPageDriver(overrides.geo ?? geometry(), overrides.scrollResult);
  const clock = overrides.clock ?? new FakeClock(0);
  const sleep = vi.fn(() => Promise.resolve());

  const deps: FullPageCaptureDeps = {
    tabId: TAB_ID,
    capture,
    blobs,
    driver,
    target: overrides.target ?? 'chrome',
    clock,
    sleep,
    // Omit the optional props entirely when unset (exactOptionalPropertyTypes).
    ...(overrides.cap !== undefined ? { cap: overrides.cap } : {}),
    ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
  };
  return { deps, capture, blobs, driver, clock, sleep };
}

describe('captureFullPage (FP2-FR3 / FP3-FR3/FR4 / FP6-FR1/FR2/FR3)', () => {
  let putSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('happy path (FP2-FR3 / FP3-FR4)', () => {
    it('captures N ordered tiles, one blob per tile, dispose once', async () => {
      const h = harness();
      putSpy = vi.spyOn(h.blobs, 'put');

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('expected ok');
      }
      const { tiles, geometry: geo, truncated } = result.value;

      // tiles.length === offsets.length ([0, 800, 1600]).
      expect(tiles).toHaveLength(3);
      // Each tile's offsetY equals the planned offset, in order.
      expect(tiles.map((t) => t.offsetY)).toEqual([0, 800, 1600]);
      // Handles are real, distinct stored handles.
      expect(new Set(tiles.map((t) => t.handle)).size).toBe(3);

      // windowIdOf(tabId) called exactly once with the right tab.
      expect(h.capture.windowIdCalls).toEqual([TAB_ID]);
      // Every captureViewport got that windowId.
      expect(h.capture.captureCalls).toEqual([WINDOW_ID, WINDOW_ID, WINDOW_ID]);

      // blobs.put called once per tile with the PNG content type.
      expect(putSpy).toHaveBeenCalledTimes(3);
      for (const call of putSpy.mock.calls) {
        expect(call[1]).toBe('image/png');
      }

      expect(truncated).toBe(false);
      expect(geo).toBe(result.value.geometry);
      expect(h.driver.disposeCalls).toBe(1);
    });

    it('stores the actual captured bytes out-of-band (FP3-FR4)', async () => {
      const h = harness();
      const result = await captureFullPage(h.deps);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('expected ok');
      }
      // Each handle resolves to non-empty stored bytes.
      for (const tile of result.value.tiles) {
        const stored = await h.blobs.get(tile.handle);
        expect(stored?.contentType).toBe('image/png');
        expect(stored?.bytes.length).toBeGreaterThan(0);
      }
    });
  });

  describe('retry-once (FP3-FR3)', () => {
    it('retries once then succeeds → still N tiles, no error', async () => {
      const h = harness({ failNext: 1 });

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('expected ok');
      }
      expect(result.value.tiles).toHaveLength(3);
      expect(h.driver.disposeCalls).toBe(1);
    });

    it('fails with capture-failed after the retry is exhausted; dispose still runs', async () => {
      // failNext=2 → 1 initial + 1 retry both throw (MAX_TILE_RETRIES=1).
      const h = harness({ failNext: 2 });

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('expected err');
      }
      expect(result.error.kind).toBe('capture-failed');
      expect(result.error.message).toMatch(/capture/i);
      expect(h.driver.disposeCalls).toBe(1);
    });
  });

  describe('timeout (FP6-FR2)', () => {
    it('returns capture-timeout when now()-start exceeds timeoutMs; dispose runs', async () => {
      // Clock reads 0 for `start`, then jumps to 5000 on the next read so the
      // i===0 iteration's timeout guard fires before any capture.
      let reads = 0;
      const clock = new FakeClock(0);
      vi.spyOn(clock, 'now').mockImplementation(() => {
        reads += 1;
        return reads === 1 ? 0 : 5000;
      });
      const h = harness({ timeoutMs: 1000, clock });

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('expected err');
      }
      expect(result.error.kind).toBe('capture-timeout');
      expect(result.error.message).toMatch(/timed out/i);
      // No tile was captured (timeout hit at the top of i===0).
      expect(h.capture.captureCalls).toHaveLength(0);
      expect(h.driver.disposeCalls).toBe(1);
    });

    it('does not time out when timeoutMs is absent (unbounded run)', async () => {
      const clock = new FakeClock(0);
      clock.set(1_000_000); // large "now" must not matter without timeoutMs
      const h = harness({ clock });

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('expected ok');
      }
      expect(result.value.tiles).toHaveLength(3);
    });
  });

  describe('non-scroll fallback (FP6-FR3)', () => {
    it('breaks when the document does not move for i>0, keeping tiles so far', async () => {
      // scrollTo returns the SAME y (a stuck SPA) for every request after 0.
      // i===0 captures (progress check skipped); i===1 sees no progress → break.
      const h = harness({ scrollResult: () => 0 });

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('expected ok');
      }
      // First tile is always taken; the loop breaks before the second blob.
      expect(result.value.tiles).toHaveLength(1);
      expect(result.value.tiles[0]!.offsetY).toBe(0);
      expect(result.value.truncated).toBe(false);
      // sleep/capture happened once (only the i===0 tile).
      expect(h.capture.captureCalls).toHaveLength(1);
      expect(h.driver.disposeCalls).toBe(1);
    });

    it('always takes the i===0 tile even when actualY differs from offset', async () => {
      // A page that never reports the requested y still yields the first tile,
      // because the progress check is skipped for i===0.
      const h = harness({ scrollResult: () => 999 });

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('expected ok');
      }
      // i===0 tile taken; i===1 sees prevY(999) === actualY(999) → break.
      expect(result.value.tiles).toHaveLength(1);
      expect(result.value.tiles[0]!.offsetY).toBe(0);
    });
  });

  describe('page-cap truncation (FP6-FR1)', () => {
    it('stops at maxPages with truncated:true and ok', async () => {
      const cap: FullPageCap = { maxPages: 1, maxHeightPx: Number.MAX_SAFE_INTEGER };
      const h = harness({ cap }); // geometry → 3 offsets, but cap stops at 1.

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('expected ok');
      }
      expect(result.value.tiles).toHaveLength(1);
      expect(result.value.truncated).toBe(true);
      expect(h.capture.captureCalls).toHaveLength(1);
      expect(h.driver.disposeCalls).toBe(1);
    });
  });

  describe('single-tile page (FP2-FR1)', () => {
    it('captures exactly one tile with no break for a short page', async () => {
      // total <= viewport → planScrollOffsets = [0].
      const h = harness({ geo: geometry(600, 800) });

      const result = await captureFullPage(h.deps);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('expected ok');
      }
      expect(result.value.tiles).toHaveLength(1);
      expect(result.value.tiles[0]!.offsetY).toBe(0);
      expect(result.value.truncated).toBe(false);
    });
  });

  describe('throttle (FP3-FR2)', () => {
    it('sleeps once per captured tile at the Chrome delay (500ms)', async () => {
      const h = harness({ target: 'chrome' });

      await captureFullPage(h.deps);

      expect(h.sleep).toHaveBeenCalledTimes(3);
      for (const call of h.sleep.mock.calls) {
        expect(call[0]).toBe(CHROME_CAPTURE_DELAY_MS);
      }
    });

    it('sleeps at the Firefox delay (600ms)', async () => {
      const h = harness({ target: 'firefox' });

      await captureFullPage(h.deps);

      expect(h.sleep).toHaveBeenCalledTimes(3);
      for (const call of h.sleep.mock.calls) {
        expect(call[0]).toBe(FIREFOX_CAPTURE_DELAY_MS);
      }
    });
  });

  describe('dispose-always (FP2-FR4 / IP-1)', () => {
    it('disposes on success', async () => {
      const h = harness();
      await captureFullPage(h.deps);
      expect(h.driver.disposeCalls).toBe(1);
    });

    it('disposes on page-cap truncation', async () => {
      const h = harness({ cap: { maxPages: 1, maxHeightPx: Number.MAX_SAFE_INTEGER } });
      await captureFullPage(h.deps);
      expect(h.driver.disposeCalls).toBe(1);
    });

    it('disposes on timeout', async () => {
      let reads = 0;
      const clock = new FakeClock(0);
      vi.spyOn(clock, 'now').mockImplementation(() => {
        reads += 1;
        return reads === 1 ? 0 : 5000;
      });
      const h = harness({ timeoutMs: 1000, clock });
      await captureFullPage(h.deps);
      expect(h.driver.disposeCalls).toBe(1);
    });

    it('disposes on capture-failed', async () => {
      const h = harness({ failNext: 2 });
      await captureFullPage(h.deps);
      expect(h.driver.disposeCalls).toBe(1);
    });
  });
});
