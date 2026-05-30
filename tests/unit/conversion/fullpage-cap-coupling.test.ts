/**
 * FullPageCap.maxPages coupling (review issue #7) — the SAME `maxPages` knob
 * bounds two different stages with deliberately-coupled intent ("≤ N screens"):
 *   - capture (`captureFullPage`): caps the number of VIEWPORT TILES grabbed;
 *   - paginate (`planFullPage`): caps the number of PDF PAGE-BANDS produced.
 * These tiles and page-bands are different heights, so this test pins the
 * coupling explicitly: one value, both stages honour it, both flag truncation.
 */
import { describe, expect, it, vi } from 'vitest';
import { captureFullPage, type FullPageCaptureDeps } from '@capture/capture-fullpage';
import {
  type FullPageCap,
  planFullPage,
  type StitchGeometry,
} from '@conversion/fullpage-stitch-core';
import { InMemoryBlobTransfer } from '../../../src/background/in-memory-blob-transfer';
import { FakeCapturePort } from '../../fakes/fake-capture-port';
import { FakeClock } from '../../fakes/fake-clock';
import { FakeFullPageDriver } from '../../fakes/fake-fullpage-driver';
import { FakeRandomSource } from '../../fakes/fake-random-source';

const MAX_PAGES = 3;
const cap: FullPageCap = { maxPages: MAX_PAGES, maxHeightPx: Number.MAX_SAFE_INTEGER };

// total 4000 / vh 800 → planScrollOffsets = [0,800,1600,2400,3200] (5 tiles available).
const geometry: StitchGeometry = {
  totalHeight: 4000,
  viewportHeight: 800,
  width: 1280,
  dpr: 1,
  pageSize: 'a4',
};

describe('FullPageCap.maxPages — capture-tile / pdf-page coupling (#7)', () => {
  it('caps the captured VIEWPORT TILES at maxPages and flags truncation', async () => {
    const deps: FullPageCaptureDeps = {
      tabId: 1,
      capture: new FakeCapturePort(7),
      blobs: new InMemoryBlobTransfer(new FakeRandomSource()),
      driver: new FakeFullPageDriver(geometry),
      target: 'chrome',
      clock: new FakeClock(0),
      sleep: vi.fn(() => Promise.resolve()),
      cap,
    };

    const result = await captureFullPage(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected ok');
    }
    // 5 offsets were available, but maxPages=3 stopped the scroll loop at 3 tiles.
    expect(result.value.tiles).toHaveLength(MAX_PAGES);
    expect(result.value.truncated).toBe(true);
  });

  it('caps the planned PDF PAGE-BANDS at the same maxPages and flags truncation', () => {
    // A page far taller than maxPages·pageHeightPx, so the page-count cap binds.
    const plan = planFullPage({ ...geometry, totalHeight: 100_000 }, cap);

    // The very same maxPages bounds the PDF to exactly MAX_PAGES page-bands.
    expect(plan.pageSlices).toHaveLength(MAX_PAGES);
    expect(plan.truncated).toBe(true);
  });
});
