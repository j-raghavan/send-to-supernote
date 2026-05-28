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
      },
    },
  },
});
