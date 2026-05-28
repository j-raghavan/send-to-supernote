import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import webExtension from '@samrum/vite-plugin-web-extension';
import { manifest } from './manifest.config';

export default defineConfig({
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
      },
    },
  },
});
