import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import webExtension from '@samrum/vite-plugin-web-extension';
import { buildManifest, type ExtensionTarget } from './manifest.config';

const alias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
  '@auth': fileURLToPath(new URL('./src/auth', import.meta.url)),
  '@capture': fileURLToPath(new URL('./src/capture', import.meta.url)),
  '@conversion': fileURLToPath(new URL('./src/conversion', import.meta.url)),
  '@delivery': fileURLToPath(new URL('./src/delivery', import.meta.url)),
  '@settings': fileURLToPath(new URL('./src/settings', import.meta.url)),
  '@jobs': fileURLToPath(new URL('./src/jobs', import.meta.url)),
};

/**
 * The Firefox event-page background source. `@samrum/vite-plugin-web-extension`
 * registers it as an `additionalInputs.scripts` entry; the plugin then emits a
 * built loader whose name is `getOutputFileName(<input>) + '.js'` — i.e. the
 * input path with its `.ts` extension swapped for `.js` (see plugin
 * `parseOutputChunk` / `getOutputFileName`). For this input that is
 * `src/background/service-worker.js`.
 *
 * NOTE (ADR D4, refined during FF6 implementation): the plugin's `parseInput`
 * pipe ALWAYS runs `parseInputBackgroundScripts`, even for MV3 (it is in the
 * shared base pipe, not gated by the MV3 `getParseInputMethods()`). For an MV3
 * manifest that still produces a MV2-style `background.page` HTML loader pointing
 * at the LITERAL script path, which (a) is not valid MV3 and (b) fails the build
 * because that literal path is not a real Rollup input. So we must NOT hand the
 * plugin a manifest containing `background.scripts`: we strip `background`
 * entirely from the manifest the plugin sees, emit the background via
 * `additionalInputs.scripts`, and write the correct MV3 event-page `background`
 * back into `manifest.json` in the post-build patch below.
 */
const FIREFOX_BACKGROUND_INPUT = 'src/background/service-worker.ts';
const FIREFOX_BACKGROUND_OUTPUT = 'src/background/service-worker.js';

/**
 * Patch `dist-firefox/manifest.json` after `@samrum/vite-plugin-web-extension`
 * has written it (ADR D4 — verified plugin limitation).
 *
 * The plugin's MV3 manifest parser (`getParseInputMethods()` →
 * `parseInputBackgroundServiceWorker` only) recognises `background.service_worker`
 * but SILENTLY IGNORES `background.scripts`: the `parseInputBackgroundScripts`
 * converter that would turn `scripts` into an event-page input is wired only into
 * the MV2 path. So for our MV3 Firefox manifest the plugin neither emits a chunk
 * for the event-page background nor rewrites its filename — it just passes the
 * literal `background.scripts` value through to the output manifest.
 *
 * We therefore feed the background source via `additionalInputs.scripts` (so a
 * real, hashed, code-split `.js` loader IS emitted) and, in this hook, rewrite
 * the output manifest's `background` to point at that emitted loader as an
 * MV3 event page (`{ scripts: [...], type: 'module' }`) with NO `service_worker`.
 *
 * Runs only for the Firefox build; Chrome keeps the plugin-native
 * `background.service_worker` path entirely unchanged.
 */
function firefoxBackgroundManifestPatch(outDir: string): Plugin {
  return {
    name: 'firefox-background-manifest-patch',
    // `writeBundle` runs after the plugin's own emit has flushed `manifest.json`,
    // so we read-modify-write the final file (and we get the `bundle` to inspect).
    //
    // CRITICAL (MV3 listener registration): `additionalInputs.scripts` emits the
    // background as an async IIFE LOADER —
    //   (async()=>{await import(getURL("…service-worker-<hash>.js"))})()
    // — which `import()`s the real module. That defers onMessage/cookies/tabs
    // listener registration to a microtask AFTER the event page is considered
    // "ready", so the first popup message ("connect-cloud") races ahead of the
    // listener → "Could not establish connection. Receiving end does not exist."
    // MV3 requires listeners to register SYNCHRONOUSLY at top level. So we point
    // `background.scripts` at the REAL module (the loader's dynamic import target)
    // — loaded directly, its top-level code registers the listeners during module
    // evaluation, before any event is dispatched. The unused loader file is inert.
    async writeBundle() {
      // Read the emitted loader and extract the real module it imports — robust
      // across bundlers (Vite 8 uses Rolldown, whose chunk metadata differs from
      // Rollup's, so we parse the loader's `getURL("…")` argument rather than rely
      // on `bundle.dynamicImports`).
      const loaderPath = join(outDir, FIREFOX_BACKGROUND_OUTPUT);
      const loaderSrc = await readFile(loaderPath, 'utf8');
      const realModule = /getURL\(\s*["']([^"']+)["']\s*\)/.exec(loaderSrc)?.[1];
      if (realModule === undefined) {
        // The plugin's loader shape changed — fail loudly rather than ship a
        // background whose listeners register late.
        throw new Error(
          `firefox-background-manifest-patch: could not extract the real background module from ${FIREFOX_BACKGROUND_OUTPUT}`,
        );
      }
      const manifestPath = join(outDir, 'manifest.json');
      const raw = await readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.background = { scripts: [realModule], type: 'module' };
      await writeFile(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    },
  };
}

export default defineConfig(({ mode }) => {
  const target: ExtensionTarget = mode === 'firefox' ? 'firefox' : 'chrome';
  const isFirefox = target === 'firefox';
  const outDir = isFirefox ? 'dist-firefox' : 'dist';

  // Rollup HTML inputs. `privacy` ships on BOTH targets. The offscreen document
  // is Chrome-only (Firefox renders in-page via DirectRenderer — FF2/FF6-FR2),
  // so its HTML input is omitted for Firefox; the offscreen modules are already
  // dead-branch-eliminated there via `__TARGET__` gating.
  const input: Record<string, string> = {
    privacy: fileURLToPath(new URL('./src/privacy/privacy.html', import.meta.url)),
  };
  if (!isFirefox) {
    input.offscreen = fileURLToPath(new URL('./src/offscreen/offscreen.html', import.meta.url));
  }

  // For Firefox, hand the plugin a manifest WITHOUT `background` (see the
  // FIREFOX_BACKGROUND_* note above): the plugin's shared parse pipe always runs
  // `parseInputBackgroundScripts`, which would otherwise mangle our MV3
  // `background.scripts` into an invalid `background.page` HTML loader and break
  // the build. The patch plugin writes the correct MV3 event-page `background`
  // back afterwards. Chrome passes its manifest through unchanged (service worker).
  const { background: _firefoxBackground, ...firefoxManifestNoBackground } =
    buildManifest('firefox');
  const pluginManifest = isFirefox
    ? (firefoxManifestNoBackground as chrome.runtime.ManifestV3)
    : (buildManifest('chrome') as chrome.runtime.ManifestV3);

  return {
    // Build-time target constants (FF4-FR2, generalized in FF6). Resolved to
    // literals so Rollup can dead-branch-eliminate the non-target code paths
    // (e.g. the offscreen adapters drop out of the Firefox bundle). USE_WEBREQUEST
    // stays false on both targets — DNR is the default origin-strip strategy
    // (ADR D3); the blocking-webRequest fallback is built but not wired.
    define: {
      __TARGET__: JSON.stringify(target),
      __USE_WEBREQUEST__: 'false',
    },
    resolve: { alias },
    plugins: [
      webExtension({
        manifest: pluginManifest,
        // Firefox only: feed the event-page background source so the bundler
        // emits a real built loader (`src/background/service-worker.js`). The
        // manifest's `background.scripts` is reconciled to it by the patch plugin
        // below (ADR D4). `webAccessible: false` keeps it out of
        // web_accessible_resources (least-privilege; it is the background, not a
        // page-injected script).
        ...(isFirefox
          ? {
              additionalInputs: {
                scripts: [{ fileName: FIREFOX_BACKGROUND_INPUT, webAccessible: false }],
              },
            }
          : {}),
      }),
      ...(isFirefox ? [firefoxBackgroundManifestPatch(outDir)] : []),
    ],
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: { input },
    },
  };
});
