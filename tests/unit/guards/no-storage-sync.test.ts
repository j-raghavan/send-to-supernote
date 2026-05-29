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

describe('I-5 no chrome.storage.sync guard (pulled forward from F10)', () => {
  it('never references chrome.storage.sync anywhere in src (code, not comments)', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/chrome\.storage\.sync|storage\.sync/.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the storage adapter uses chrome.storage.local', () => {
    const code = stripComments(readFileSync(STORAGE_ADAPTER, 'utf8'));
    expect(code).toContain('chrome.storage.local');
  });
});
