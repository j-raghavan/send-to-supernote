/**
 * browser-api shim (FF1-FR1, FF1-AC1/AC2, ADR-FIREFOX-PORT D6).
 *
 * `api` binds at module-load from `globalThis.browser ?? globalThis.chrome`.
 * Because the shim is COVERED (not c8-ignored), BOTH branches of the `??` must
 * be exercised to keep 100% coverage:
 *   - left-defined  → Firefox path: `globalThis.browser` is present → api === browser (FF1-AC2)
 *   - left-undefined → Chrome  path: `globalThis.browser` absent     → api === chrome  (FF1-AC1)
 *
 * The binding is a module-load-time evaluation, so each case uses
 * `vi.resetModules()` + a dynamic `import()` to re-evaluate the module under a
 * freshly stubbed global state, and `vi.unstubAllGlobals()` to isolate cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('browser-api shim — unified WebExtension namespace (FF1-FR1)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('resolves to globalThis.browser when present (Firefox path, FF1-AC2)', async () => {
    const fakeBrowser = { __isBrowser: true } as unknown as typeof chrome;
    const fakeChrome = { __isChrome: true } as unknown as typeof chrome;
    vi.stubGlobal('browser', fakeBrowser);
    vi.stubGlobal('chrome', fakeChrome);

    const { api } = await import('@shared/browser-api');

    // Left operand of `??` is defined → it is selected (Firefox), never chrome.
    expect(api).toBe(fakeBrowser);
    expect(api).not.toBe(fakeChrome);
  });

  it('falls back to globalThis.chrome when browser is undefined (Chrome path, FF1-AC1)', async () => {
    const fakeChrome = { __isChrome: true } as unknown as typeof chrome;
    // Ensure `browser` is genuinely unset so the `??` takes its right branch.
    vi.stubGlobal('browser', undefined);
    vi.stubGlobal('chrome', fakeChrome);

    const { api } = await import('@shared/browser-api');

    // Left operand is undefined → right operand (chrome) is selected.
    expect(api).toBe(fakeChrome);
  });
});
