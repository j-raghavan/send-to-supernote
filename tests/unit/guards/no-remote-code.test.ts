import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

/** All source files under src/ (ts + html) that ship in the build. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|html)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('F10-FR4: no runtime remote code (all libs bundled)', () => {
  it('no <script src> points at a remote (http/https/protocol-relative) URL', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(file, 'utf8');
      // <script ... src="http(s)://..." or "//cdn...">
      if (/<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i.test(html)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no dynamic import() of a remote URL string', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC).filter((f) => f.endsWith('.ts'))) {
      const code = stripTsComments(readFileSync(file, 'utf8'));
      // import("http(s)://...") or import('//cdn...')
      if (/\bimport\s*\(\s*["'](?:https?:)?\/\//i.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the conversion libraries are bundled (imported by module specifier, not a URL)', () => {
    // Sanity: the bundled libs are imported from node_modules specifiers, which
    // Vite bundles — never fetched at runtime.
    const adapters = [
      'content/reader.ts',
      'offscreen/pdf-renderer.ts',
      'offscreen/canvas-raster.ts',
      'offscreen/epub-renderer.ts',
    ].map((p) => readFileSync(join(SRC, p), 'utf8'));
    const all = adapters.join('\n');
    expect(all).toContain("from '@mozilla/readability'");
    expect(all).toContain("from 'jspdf'");
    expect(all).toContain("from 'html2canvas'");
    expect(all).toContain("from 'jszip'");
  });
});
