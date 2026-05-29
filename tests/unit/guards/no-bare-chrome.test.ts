/**
 * FF1-AC3 / FF1-FR2 namespace-discipline guard.
 *
 * After the Firefox port (FF1), the cross-browser adapters must route every
 * RUNTIME WebExtension call through the `api` shim (`@shared/browser-api`),
 * never a bare `chrome.*` VALUE. The same source then compiles byte-identically
 * for Chrome and Firefox. This guard is a static tripwire over `src/`:
 *
 *   1. Each of the 13 SHIMMED adapter files: no runtime `chrome.<ns>.<member>`
 *      value usage, and each imports `@shared/browser-api`.
 *   2. The 5 EXEMPT offscreen files (Chrome-only, excluded from the FF bundle):
 *      bare `chrome.*` is allowed; they do NOT import the shim.
 *   3. `src/domain/**` and `src/conversion/**` are platform-free: no runtime
 *      `chrome.`/`api.` usage at all (FF1-AC3).
 *
 * The value-vs-type distinction: a TYPE reference like
 * `: chrome.storage.LocalStorageArea {` (a @types/chrome namespace type) is NOT
 * a runtime usage. The detection regex requires a VALUE-access continuation
 * after the member (`.`, `(`, or `[` — a property read, call, or index), which
 * a bare type ref (followed by ` {`, `;`, `,`, `)`, `=`, `|`, etc.) never has.
 * Comments and string literals are stripped first so doc mentions of
 * `chrome.storage.local` and string args do not trip it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

/** Strip block + line comments (identical spirit to the other guards). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Strip string/template literals so a `chrome.*` mention inside a string arg
 * (or a template) is never mistaken for a runtime usage. Runs after comments.
 */
function stripStrings(source: string): string {
  return source
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function strip(source: string): string {
  return stripStrings(stripComments(source));
}

/**
 * Runtime VALUE usage of `chrome.<ns>.<member>` followed by a value-access
 * continuation (`.` property/call chain, `(` call, or `[` index). This matches
 * `chrome.storage.local.set(`, `chrome.action.setBadgeText(`,
 * `chrome.tabs.create(`, `chrome.runtime.onMessage.addListener(`, etc.
 *
 * It deliberately does NOT match the bare TYPE ref
 * `chrome.storage.LocalStorageArea` (followed by ` {`/`;`/`)` — no `.`/`(`/`[`),
 * so a @types/chrome namespace type in a shimmed file does not trip the guard.
 */
const CHROME_VALUE_RE = /(?<![\w.])chrome\.\w+\.\w+\s*[.([]/;
function hasRuntimeChrome(source: string): boolean {
  return CHROME_VALUE_RE.test(strip(source));
}

/** Same predicate for the shim namespace `api.<ns>.<member>...` (value usage). */
const API_VALUE_RE = /(?<![\w.])api\.\w+\.\w+\s*[.([]/;
function hasRuntimeApi(source: string): boolean {
  return API_VALUE_RE.test(strip(source));
}

const SHIM_IMPORT = "from '@shared/browser-api'";

/** The 13 adapters routed through the shim (FF1). */
const SHIMMED = [
  'background/chrome-storage.ts',
  'background/cookie-reader.ts',
  'background/notifications.ts',
  'background/fallback-prompt.ts',
  'background/badge.ts',
  'background/context-menus.ts',
  'background/permissions.ts',
  'background/scripting-extractor.ts',
  'background/tab-controller.ts',
  'background/options-opener.ts',
  'background/service-worker.ts',
  'popup/popup.ts',
  'options/options.ts',
];

/** Chrome-only files excluded from the Firefox bundle — bare chrome.* allowed. */
const EXEMPT = [
  'background/offscreen-manager.ts',
  'background/offscreen-host.ts',
  'background/offscreen-renderer.ts',
  'background/offscreen-reader.ts',
  'offscreen/offscreen.ts',
];

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

describe('FF1-AC3 / FF1-FR2: WebExtension namespace discipline', () => {
  describe('shimmed adapters route runtime calls through the `api` shim', () => {
    for (const rel of SHIMMED) {
      it(`${rel} has no bare runtime chrome.* value usage`, () => {
        expect(hasRuntimeChrome(read(rel))).toBe(false);
      });

      it(`${rel} imports the browser-api shim`, () => {
        expect(read(rel)).toContain(SHIM_IMPORT);
      });
    }
  });

  describe('exempt Chrome-only offscreen files (allowlisted bare chrome.*)', () => {
    for (const rel of EXEMPT) {
      it(`${rel} is documented Chrome-only and does NOT import the shim`, () => {
        // These ship only in the Chrome bundle, so bare chrome.* is fine; they
        // must NOT pull in the cross-browser shim (it would imply portability).
        expect(read(rel)).not.toContain(SHIM_IMPORT);
      });
    }
  });

  describe('domain & conversion are platform-free (no chrome/api at runtime)', () => {
    // Derived dynamically (not hardcoded) so a NEW domain/conversion file that
    // leaks a runtime chrome.*/api.* call cannot silently escape this guard.
    const tsFiles = (dir: string): string[] =>
      readdirSync(join(SRC, dir))
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
        .map((f) => `${dir}/${f}`);
    const PLATFORM_FREE = [...tsFiles('domain'), ...tsFiles('conversion')];

    for (const rel of PLATFORM_FREE) {
      it(`${rel} contains no runtime chrome.* / api.* usage`, () => {
        const code = read(rel);
        expect(hasRuntimeChrome(code)).toBe(false);
        expect(hasRuntimeApi(code)).toBe(false);
      });
    }
  });
});

describe('no-bare-chrome predicate has teeth (FF1 negative control)', () => {
  it('FAILS-detects a synthetic runtime chrome value chain', () => {
    expect(hasRuntimeChrome('await chrome.storage.local.get(key);')).toBe(true);
    expect(hasRuntimeChrome('chrome.action.setBadgeText({ text });')).toBe(true);
    expect(hasRuntimeChrome('chrome.tabs.create({ url });')).toBe(true);
    expect(hasRuntimeChrome("chrome.storage.local['k']")).toBe(true);
  });

  it('does NOT trip on the type-only chrome.storage.LocalStorageArea ref', () => {
    expect(hasRuntimeChrome('private get area(): chrome.storage.LocalStorageArea {')).toBe(false);
  });

  it('does NOT trip on a chrome.* mention inside a comment or string', () => {
    expect(hasRuntimeChrome('// the real chrome.storage.local.get() lives here')).toBe(false);
    expect(hasRuntimeChrome('const note = "uses chrome.storage.local.set under the hood";')).toBe(
      false,
    );
  });

  it('does NOT false-positive on the shim usage api.storage.local', () => {
    expect(hasRuntimeChrome('return api.storage.local;')).toBe(false);
  });

  it('the api predicate detects runtime api.* value chains (for platform-free files)', () => {
    expect(hasRuntimeApi('return api.storage.local.get(k);')).toBe(true);
    expect(hasRuntimeApi('api.action.setBadgeText({ text });')).toBe(true);
  });

  it('the api predicate does NOT trip on comments/strings or unrelated identifiers', () => {
    expect(hasRuntimeApi('// see api.storage.local.get usage in the adapter')).toBe(false);
    expect(hasRuntimeApi('const apiBase = config.apiUrl;')).toBe(false);
  });
});
