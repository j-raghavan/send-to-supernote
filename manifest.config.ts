/**
 * MV3 manifest as typed data (F1).
 *
 * Kept as plain data so the bundler choice stays swappable (ADR-0002) and the
 * least-privilege permission set is reviewable at a glance (F10-FR2).
 *
 * `version` is sourced from package.json so it is the single SemVer source of
 * truth: bump with `npm version <major|minor|patch>` and the built manifest
 * (and the release tag, via CI) follow. Chrome manifest versions must be
 * numeric MAJOR.MINOR.PATCH — do not use SemVer pre-release/build suffixes
 * (e.g. `-beta`) for store builds.
 */
import pkg from './package.json' with { type: 'json' };

export const manifest: chrome.runtime.ManifestV3 = {
  manifest_version: 3,
  name: 'Send to Supernote',
  version: pkg.version,
  description:
    'Capture the current web page and send it to your Supernote tablet via Supernote Cloud or your own Private Cloud.',

  // F1-FR1: background service worker (module type), toolbar action, options page.
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
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
  permissions: [
    'activeTab',
    'scripting',
    'contextMenus',
    'storage',
    'notifications',
    'offscreen',
    'declarativeNetRequestWithHostAccess',
  ],

  // Strip the `Origin` header on Supernote API requests (see permissions note).
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

export default manifest;
