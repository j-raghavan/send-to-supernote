/**
 * FF6-AC3 / FF6-FR2 — Firefox build excludes the offscreen document.
 *
 * The offscreen document is Chrome-only (Firefox renders in-page via
 * DirectRenderer — FF2). This audit drives the real `vite.config.ts` factory for
 * both targets and asserts the build-shape guarantees that keep offscreen out of
 * the Firefox bundle:
 *   - the offscreen HTML Rollup input is present for Chrome, ABSENT for Firefox;
 *   - `__TARGET__` is the literal each target needs, so the FF4 dead-branch
 *     elimination drops the offscreen *modules* from the Firefox bundle;
 *   - Firefox writes to `dist-firefox/` and wires the event-page background patch.
 *
 * This is the fast, deterministic config-level proof. The full emitted-bundle
 * audit (no `offscreen.html` on disk, `background.scripts` in the output
 * manifest) runs in CI after an actual `npm run build:firefox` (FF7-FR1).
 */
import { describe, expect, it } from 'vitest';
import type { UserConfig } from 'vite';
import configExport from '../../vite.config';

type ConfigEnv = { mode: string; command: 'build' | 'serve' };
type ConfigFactory = (env: ConfigEnv) => UserConfig;

/** Resolve the (function) config export for a given Vite mode. */
function resolve(mode: string): UserConfig {
  // vite.config.ts's default export is the mode-driven factory function.
  const factory: ConfigFactory = configExport;
  return factory({ mode, command: 'build' });
}

/**
 * Collect plugin names from Vite's possibly-nested plugin tree. Walks `unknown`
 * recursively (rather than `flat(Infinity)`) because Vite's PluginOption type is
 * deeply recursive — flattening it makes tsc bail with TS2589, while the casts
 * needed to avoid that trip no-unnecessary-type-assertion. `'name' in node`
 * narrows without a cast.
 */
function collectNames(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node as unknown[]) {
      collectNames(child, out);
    }
  } else if (node !== null && typeof node === 'object' && 'name' in node) {
    const name = node.name;
    if (typeof name === 'string') {
      out.push(name);
    }
  }
}

function pluginNames(config: UserConfig): string[] {
  const out: string[] = [];
  collectNames(config.plugins, out);
  return out;
}

function inputKeys(config: UserConfig): string[] {
  const input = config.build?.rollupOptions?.input;
  return input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input) : [];
}

describe('FF6-AC3: Firefox build shape excludes offscreen', () => {
  it('Firefox build omits the offscreen HTML input (keeps privacy)', () => {
    const keys = inputKeys(resolve('firefox'));
    expect(keys).toContain('privacy');
    expect(keys).not.toContain('offscreen');
  });

  it('Chrome build KEEPS the offscreen HTML input (no regression)', () => {
    const keys = inputKeys(resolve('chrome'));
    expect(keys).toContain('offscreen');
    expect(keys).toContain('privacy');
  });

  it('defines __TARGET__ as the build-target literal (drives FF4 tree-shaking)', () => {
    expect(resolve('firefox').define?.__TARGET__).toBe(JSON.stringify('firefox'));
    expect(resolve('chrome').define?.__TARGET__).toBe(JSON.stringify('chrome'));
  });

  it('keeps __USE_WEBREQUEST__ false on both targets (DNR is the default)', () => {
    expect(resolve('firefox').define?.__USE_WEBREQUEST__).toBe('false');
    expect(resolve('chrome').define?.__USE_WEBREQUEST__).toBe('false');
  });

  it('writes to dist-firefox/ and wires the event-page background patch for Firefox', () => {
    const ff = resolve('firefox');
    expect(ff.build?.outDir).toBe('dist-firefox');
    expect(pluginNames(ff)).toContain('firefox-background-manifest-patch');
  });

  it('writes to dist/ and does NOT add the Firefox background patch for Chrome', () => {
    const chrome = resolve('chrome');
    expect(chrome.build?.outDir).toBe('dist');
    expect(pluginNames(chrome)).not.toContain('firefox-background-manifest-patch');
  });

  it('an unknown mode defaults to the Chrome target (safe default)', () => {
    expect(resolve('production').define?.__TARGET__).toBe(JSON.stringify('chrome'));
    expect(inputKeys(resolve('production'))).toContain('offscreen');
  });
});
