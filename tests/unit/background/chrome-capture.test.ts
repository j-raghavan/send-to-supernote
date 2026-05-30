/**
 * ChromeFullPageDriver scroll-restore wiring (review issue #1 / FP2-FR4).
 *
 * `chrome-capture.ts` is the c8-ignored DOM/chrome glue, so this does not move
 * coverage — it is a confidence test that the fix is wired correctly: `measure()`
 * records the page's pre-capture `scrollY`, and `dispose()` passes THAT value to
 * its restore injection (rather than the old hard-coded 0). `api.scripting.
 * executeScript` is mocked at the module boundary; the injected page functions
 * are never executed (we only assert the call wiring).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const executeScript = vi.fn<(arg: unknown) => Promise<Array<{ result: unknown }>>>();
vi.mock('@shared/browser-api', () => ({
  api: {
    scripting: { executeScript: (arg: unknown) => executeScript(arg) },
    runtime: { getPlatformInfo: vi.fn(() => Promise.resolve({})) },
  },
}));

import { ChromeFullPageDriver } from '../../../src/background/chrome-capture';

const PRE_CAPTURE_SCROLL_Y = 1234;

beforeEach(() => {
  vi.useFakeTimers(); // keep-alive setInterval must not fire / leak a real timer
  executeScript.mockReset();
  // measure() → call #1 returns the geometry incl. scrollY; dispose() → call #2.
  executeScript.mockImplementation(() => {
    const measureResult = {
      totalHeight: 5000,
      viewportHeight: 800,
      width: 1280,
      dpr: 2,
      scrollY: PRE_CAPTURE_SCROLL_Y,
    };
    // First call is measure (returns the object); later calls (dispose) return void.
    return Promise.resolve([
      { result: executeScript.mock.calls.length === 1 ? measureResult : undefined },
    ]);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ChromeFullPageDriver — scroll restore (FP2-FR4, #1)', () => {
  it('records scrollY in measure() and restores THAT value in dispose()', async () => {
    const driver = new ChromeFullPageDriver(42, 'a4');

    const geo = await driver.measure();
    await driver.dispose();

    // measure() surfaced the real geometry but did NOT leak scrollY into it.
    expect(geo.width).toBe(1280);
    expect(geo.dpr).toBe(2);
    expect(geo.pageSize).toBe('a4');
    expect((geo as unknown as { scrollY?: number }).scrollY).toBeUndefined();

    // Two injections ran: measure (no args) then dispose (the restore Y as its arg).
    expect(executeScript).toHaveBeenCalledTimes(2);
    const measureCall = executeScript.mock.calls[0]![0] as { args?: unknown[] };
    const disposeCall = executeScript.mock.calls[1]![0] as { args?: unknown[] };
    expect(measureCall.args).toBeUndefined();
    // The fix: dispose restores the recorded pre-capture position, not 0.
    expect(disposeCall.args).toEqual([PRE_CAPTURE_SCROLL_Y]);
  });
});
