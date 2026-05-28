import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Un-unit-testable glue / DOM/host bootstrap / type-only — see architecture §9.3.
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/background/service-worker.ts',
        'src/offscreen/offscreen.ts',
        'src/options/options.ts',
        'src/popup/popup.ts',
        'src/content/reader.ts',
        'src/content/fullpage.ts',
      ],
      thresholds: {
        lines: 97,
        branches: 97,
        functions: 97,
        statements: 97,
      },
      reportsDirectory: 'coverage',
    },
  },
});
