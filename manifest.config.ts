/**
 * MV3 manifest as typed data, built per target (FF5).
 *
 * Kept as plain data so the bundler choice stays swappable (ADR-0002) and the
 * least-privilege permission set is reviewable at a glance (F10-FR2).
 *
 * Per-target split (FF5): `buildManifest(target)` produces the manifest for
 * Chrome or Firefox from a single shared base, so the two targets cannot drift
 * (DRY). Only the genuinely browser-specific bits differ:
 *   - background: Chrome uses an MV3 `service_worker`; Firefox uses an MV3
 *     event page (`background.scripts`) — Firefox does not support
 *     `service_worker` in MV3 background.
 *   - permissions: Firefox drops `offscreen` (no offscreen-documents API).
 *   - Firefox adds `browser_specific_settings.gecko` (AMO requires an add-on id).
 * Everything else (name, version, action, options_ui, icons, host perms, the
 * DNR network strategy) is identical across targets and lives in the shared base.
 *
 * Back-compat: `export const manifest = buildManifest('chrome')` and the default
 * export keep every existing `import { manifest }` consumer (vite.config.ts,
 * tests) working unchanged — FF6 will wire vite.config.ts to call buildManifest
 * per build mode.
 *
 * `version` is sourced from package.json so it is the single SemVer source of
 * truth: bump with `npm version <major|minor|patch>` and the built manifest
 * (and the release tag, via CI) follow. Chrome manifest versions must be
 * numeric MAJOR.MINOR.PATCH — do not use SemVer pre-release/build suffixes
 * (e.g. `-beta`) for store builds.
 */
import pkg from './package.json' with { type: 'json' };

export type ExtensionTarget = 'chrome' | 'firefox';

/**
 * `chrome.runtime.ManifestV3` models `background` only as a service worker and
 * has no `browser_specific_settings`. Firefox MV3 needs an event-page background
 * (`background.scripts`) and a `gecko` add-on id, so we widen the type without
 * resorting to `any` — the union of both background shapes plus the Gecko block.
 */
type FirefoxExtras = {
  background?: { service_worker?: string; scripts?: string[]; type?: 'module' };
  browser_specific_settings?: {
    gecko: {
      id: string;
      strict_min_version?: string;
      /** AMO data-collection disclosure; `['none']` declares no data collected. */
      data_collection_permissions?: { required: string[]; optional?: string[] };
    };
  };
};

export type WebExtManifest = Omit<chrome.runtime.ManifestV3, 'background'> & FirefoxExtras;

/**
 * Build the extension manifest for a given browser target.
 *
 * The shared base captures every field that is identical across Chrome and
 * Firefox; each branch then overrides only the browser-specific fields.
 */
export function buildManifest(target: ExtensionTarget): WebExtManifest {
  // Shared base — identical for Chrome and Firefox. Background is intentionally
  // omitted here and supplied per target below (the only structurally divergent
  // field). Permissions are listed in full; the `offscreen` entry is dropped for
  // Firefox in its branch.
  const base: Omit<WebExtManifest, 'background'> = {
    manifest_version: 3,
    name: 'Send to Supernote',
    version: pkg.version,
    description:
      'Capture the current web page and send it to your Supernote tablet via Supernote Cloud or your own Private Cloud.',

    // F1-FR1: toolbar action, options page (background supplied per target).
    action: {
      default_title: 'Send to Supernote',
      default_icon: {
        16: 'icons/icon16.png',
        24: 'icons/icon24.png',
        32: 'icons/icon32.png',
      },
      default_popup: 'src/popup/popup.html',
    },
    options_ui: {
      page: 'src/options/options.html',
      open_in_tab: true,
    },
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },

    // F1-FR2: least-privilege permissions. NO `debugger`, NO `identity`.
    // `declarativeNetRequestWithHostAccess` is included because the F5-FR1 live
    // spike (2026-05-28) showed viewer.supernote.com returns HTTP 403 when the
    // request carries a browser `Origin` header; the DNR ruleset below strips the
    // `Origin` header on requests to the Supernote API hosts (only — scoped by
    // host_permissions). This keeps the flow fully client-side (D-3), no relay.
    // Firefox uses the SAME DNR strategy (locked decision: __USE_WEBREQUEST__
    // defaults false), so no `webRequest`/`webRequestBlocking` is requested.
    // `cookies` lets the extension read the `x-access-token` session cookie that
    // cloud.supernote.com sets AFTER the user signs in on Supernote's own page —
    // the connect flow Supernote-Cloud auth uses (its login is CAPTCHA/2FA-gated,
    // so the extension never logs in itself). Scoped by host_permissions to the
    // Supernote hosts only; the token never leaves the device (D-3).
    // `offscreen` is Chrome-only and is dropped from the Firefox branch below.
    permissions: [
      'activeTab',
      'scripting',
      'contextMenus',
      'storage',
      'notifications',
      'offscreen',
      'cookies',
      'declarativeNetRequestWithHostAccess',
    ],

    // Strip the `Origin` header on Supernote API requests (see permissions note).
    // Shared across targets: Firefox uses DNR like Chrome (locked decision).
    declarative_net_request: {
      rule_resources: [{ id: 'supernote_headers', enabled: true, path: 'dnr-rules.json' }],
    },

    // F1-FR3: both candidate public-API hosts are declared statically (the
    // F5-FR1 spike picks which one the account uses at runtime); Ratta's S3 host
    // is included for the pre-signed PUT, narrowed as far as the spike allows.
    // NO `<all_urls>`.
    host_permissions: [
      'https://cloud.supernote.com/*',
      'https://viewer.supernote.com/*',
      'https://*.amazonaws.com/*',
    ],

    // The Private Cloud origin is user-configured at runtime, so it cannot be a
    // static host permission; it is granted via chrome.permissions.request for
    // the entered origin when the user saves their Private Cloud URL (F8-FR1).
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  };

  if (target === 'firefox') {
    // FF5-FR1: Firefox MV3 uses an event page, not a service worker. The built
    // background entry is the emitted `.js`, not the `.ts` source — FF6
    // reconciles the actual emitted filename via a post-build manifest patch
    // (ADR D4); `'service-worker.js'` is the declared intent here.
    // Drop `offscreen` (Chrome-only API); keep `cookies` and the DNR perms.
    return {
      ...base,
      permissions: base.permissions?.filter((p: string) => p !== 'offscreen'),
      background: {
        scripts: ['service-worker.js'],
        type: 'module',
      },
      // AMO requires an explicit add-on id; pin a conservative minimum (locked).
      // AMO now REQUIRES the `data_collection_permissions` disclosure on new
      // submissions (validation fails without it), so it is declared here as
      // `{ required: ['none'] }` — the extension collects no data (D-3). The key
      // is only understood by Firefox ~140+, so at our `strict_min_version: 128.0`
      // (ESR) `web-ext lint` emits an informational KEY_FIREFOX_UNSUPPORTED_BY_MIN_
      // VER *warning* (not an error — CI/lint stay green); Firefox 128–139 simply
      // ignore the unknown key. We keep 128.0 to retain ESR support rather than
      // raising the floor just to silence the warning.
      browser_specific_settings: {
        gecko: {
          id: 'send-to-supernote@j-raghavan',
          strict_min_version: '128.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    };
  }

  // Chrome (default): MV3 service worker, full permission set incl. `offscreen`.
  return {
    ...base,
    background: {
      service_worker: 'src/background/service-worker.ts',
      type: 'module',
    },
  };
}

// Back-compat: existing imports of `manifest` keep working (the Chrome manifest).
// Typed as `chrome.runtime.ManifestV3` (not the wider `WebExtManifest`) so that
// consumers expecting a Chrome manifest — notably vite.config.ts passing it to
// `@samrum/vite-plugin-web-extension`'s `manifest: chrome.runtime.Manifest`
// option — keep compiling unchanged. The cast is sound: the 'chrome' branch
// always emits a service-worker `background` and never the Firefox-only
// `scripts`/`browser_specific_settings` fields, so it is a valid MV3 manifest.
export const manifest = buildManifest('chrome') as chrome.runtime.ManifestV3;
export default manifest;
