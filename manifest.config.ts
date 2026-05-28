/**
 * MV3 manifest as typed data (F1).
 *
 * Kept as plain data so the bundler choice stays swappable (ADR-0002) and the
 * least-privilege permission set is reviewable at a glance (F10-FR2).
 */

export const manifest: chrome.runtime.ManifestV3 = {
  manifest_version: 3,
  name: 'Send to Supernote',
  version: '0.1.0',
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
};

export default manifest;
