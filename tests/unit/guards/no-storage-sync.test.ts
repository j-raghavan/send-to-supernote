import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const STORAGE_ADAPTER = fileURLToPath(
  new URL('../../../src/background/chrome-storage.ts', import.meta.url),
);

describe('I-5 no storage.sync guard (pulled forward from F10)', () => {
  it('never references storage.sync anywhere in src — chrome.* or the api shim (code, not comments)', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // Generic `storage.sync` so the guard keeps its teeth post-shim: it now
      // also forbids `api.storage.sync` (the shim could be misused that way),
      // not just the literal `chrome.storage.sync`. Stays consistent with
      // guard-robustness.test.ts's `hasStorageSync` predicate.
      if (/(?:chrome|api)\.storage\.sync|storage\.sync/.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the storage adapter targets storage.local via the browser-api shim', () => {
    const code = stripComments(readFileSync(STORAGE_ADAPTER, 'utf8'));
    // Post-FF1 the adapter routes runtime storage through the `api` shim
    // (`api.storage.local`), never bare `chrome.storage.local` at runtime. The
    // I-5 invariant (local-only, never sync) is unchanged — only the namespace
    // it goes through (the WebExtension shim) changed.
    expect(code).toContain('api.storage.local');
  });
});
