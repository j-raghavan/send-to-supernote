import { defineConfig } from 'vite';
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
  },
});
