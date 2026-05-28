import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

/** All .ts source files under src/ (excluding .html and type-decl files). */
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

/**
 * Strip line/block comments so a `fetch(` mentioned in a doc comment does not
 * trip the scan — only real call sites count.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('I-2/D-3 sole-fetch tripwire (pulled forward from F10)', () => {
  it('contains a real fetch( call in exactly one file — the FetchHttpClient adapter', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // A bare global fetch call: `fetch(` not preceded by a `.` (so `.fetch(`
      // member calls and identifiers like `fetchImage(` are excluded).
      if (/(?<![\w.])fetch\s*\(/.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual(['src/background/fetch-http-client.ts']);
  });
});
