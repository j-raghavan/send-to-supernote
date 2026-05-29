import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import webExtension from '@samrum/vite-plugin-web-extension';
import { manifest } from './manifest.config';

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

export default defineConfig({
  // Build-time target constants (FF4-FR2). Minimal Chrome defaults so the Chrome
  // build resolves `__TARGET__`/`__USE_WEBREQUEST__` to literals (enables dead-
  // branch elimination / tree-shaking). FF6 generalizes these to be mode-driven
  // (chrome vs firefox) — see src/global.d.ts.
  define: {
    __TARGET__: JSON.stringify('chrome'),
    __USE_WEBREQUEST__: 'false',
  },
  resolve: { alias },
  plugins: [
    webExtension({
      manifest,
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      // The offscreen document is opened at runtime via
      // chrome.offscreen.createDocument (F1-FR5), not declared in the manifest
      // and not web-accessible. It is added as an explicit HTML entry so Vite
      // bundles its script and emits the page to dist/ at a stable path. This
      // keeps it out of web_accessible_resources, preserving the least-privilege
      // manifest (no <all_urls> WAR — F1-FR2 / Security).
      input: {
        offscreen: fileURLToPath(new URL('./src/offscreen/offscreen.html', import.meta.url)),
        // Bundled privacy page the popup/Options "Privacy" links open (works
        // offline; not web-accessible, opened only by the extension's own UI).
        privacy: fileURLToPath(new URL('./src/privacy/privacy.html', import.meta.url)),
      },
    },
  },
});
