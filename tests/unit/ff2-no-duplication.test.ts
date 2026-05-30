/**
 * FF2-AC5 / I-F7 — DRY guard: the render/reader-parse logic lives exactly ONCE,
 * in `src/conversion/render-parse-core.ts`. The Chrome offscreen dispatcher and
 * both Firefox direct adapters delegate to it and must hold NO second copy.
 *
 * This is a source-grep guard (matching the style of `guards/no-remote-code.test.ts`):
 * it asserts the tell-tale primitives of the parse/render logic — `DOMParser`,
 * `renderEpub(`/`renderHtmlToPdf(`, the `<base>` injection, the script/style
 * fallback strip — appear in render-parse-core.ts and in NONE of the delegating
 * adapters. If someone re-inlines the logic, this fails.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

/** Strip comments so a primitive mentioned only in a doc-comment isn't a false positive. */
function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const CORE = 'conversion/render-parse-core.ts';
// The delegating callers — none may re-implement the parse/render logic.
const DELEGATORS = [
  'offscreen/offscreen.ts',
  'background/direct-renderer.ts',
  'background/direct-reader-parser.ts',
];

/** Tell-tale fragments of the single-home parse/render logic. */
const PARSE_RENDER_PRIMITIVES: Array<{ name: string; re: RegExp }> = [
  { name: 'DOMParser', re: /\bDOMParser\b/ },
  { name: 'renderEpub(', re: /\brenderEpub\s*\(/ },
  { name: 'renderHtmlToPdf(', re: /\brenderHtmlToPdf\s*\(/ },
  { name: "createElement('base') / '<base'", re: /createElement\(\s*['"]base['"]\s*\)|<base\b/ },
  {
    name: "querySelectorAll('script ...') fallback strip",
    re: /querySelectorAll\(\s*['"]script\b/,
  },
];

describe('FF2-AC5 / I-F7 — parse/render logic has exactly one home (render-parse-core)', () => {
  it('render-parse-core.ts contains the parse/render primitives (the single home)', () => {
    const core = stripTsComments(read(CORE));
    for (const { name, re } of PARSE_RENDER_PRIMITIVES) {
      expect(core, `render-parse-core.ts should contain ${name}`).toMatch(re);
    }
  });

  for (const file of DELEGATORS) {
    it(`${file} holds NO copy of the parse/render logic (delegates only)`, () => {
      const code = stripTsComments(read(file));
      const duplicated = PARSE_RENDER_PRIMITIVES.filter(({ re }) => re.test(code)).map(
        (p) => p.name,
      );
      expect(duplicated, `${file} must not re-implement: ${duplicated.join(', ')}`).toEqual([]);
    });
  }
});
