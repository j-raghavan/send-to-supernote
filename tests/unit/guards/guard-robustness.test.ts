/**
 * Negative-control robustness for the I-2 (sole-fetch) and I-5 (no .sync)
 * tripwires. The existing guards scan src/ and assert "no offenders"; a guard is
 * only trustworthy if it would actually FAIL when an offender is introduced.
 *
 * Rather than commit a second real `fetch(` or a `chrome.storage.sync` (which
 * would break the build), these tests replicate the exact detection predicates
 * the guards use and prove them against synthetic offending/clean sources —
 * i.e. they verify the guards have teeth. If a guard's regex is ever weakened,
 * these negative controls break first.
 *
 * Keep these predicates byte-identical to the guard files
 * (tests/unit/guards/{sole-fetch,no-storage-sync}.test.ts).
 */
import { describe, expect, it } from 'vitest';

/** Comment stripper — identical to the guards'. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** sole-fetch predicate: a bare global `fetch(` (not a member/identifier). */
const FETCH_RE = /(?<![\w.])fetch\s*\(/;
function hasBareFetch(source: string): boolean {
  return FETCH_RE.test(stripComments(source));
}

/** no-sync predicate: any reference to chrome.storage.sync / storage.sync. */
const SYNC_RE = /chrome\.storage\.sync|storage\.sync/;
function hasStorageSync(source: string): boolean {
  return SYNC_RE.test(stripComments(source));
}

/**
 * Hardened sole-fetch predicate (F10-FR5): the bare form OR the qualified global
 * forms globalThis/window/self.fetch — byte-identical to sole-fetch.test.ts.
 */
const QUALIFIED_FETCH_RE = /\b(?:globalThis|window|self)\.fetch\s*\(/;
function hasAnyGlobalFetch(source: string): boolean {
  const code = stripComments(source);
  return FETCH_RE.test(code) || QUALIFIED_FETCH_RE.test(code);
}

/** no-remote-code predicates (F10-FR4) — remote <script src> and URL import(). */
const REMOTE_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i;
const REMOTE_IMPORT_RE = /\bimport\s*\(\s*["'](?:https?:)?\/\//i;

describe('sole-fetch guard has teeth (I-2/D-3 negative control)', () => {
  it('FAILS-detects a newly introduced bare fetch( call site', () => {
    // A hypothetical second adapter that leaks a direct global fetch.
    const offending = `export async function leak(u: string) { return fetch(u); }`;
    expect(hasBareFetch(offending)).toBe(true);
  });

  it('detects fetch( with surrounding whitespace', () => {
    expect(hasBareFetch('const r = fetch ( url );')).toBe(true);
  });

  it('does NOT false-positive on member calls or identifiers (.fetch / fetchImage)', () => {
    expect(hasBareFetch('client.fetch(url)')).toBe(false);
    expect(hasBareFetch('await fetchImage(src)')).toBe(false);
  });

  it('does NOT trip on fetch( that only appears inside comments', () => {
    expect(hasBareFetch('// the real fetch(...) lives in the adapter\ndoThing();')).toBe(false);
    expect(hasBareFetch('/* fetch(x) is documented here */ run();')).toBe(false);
  });

  it('an all-clean source yields no detection', () => {
    expect(hasBareFetch('return this.http.request(req);')).toBe(false);
  });
});

describe('no-storage-sync guard has teeth (I-5 negative control)', () => {
  it('FAILS-detects a newly introduced chrome.storage.sync usage', () => {
    const offending = `await chrome.storage.sync.set({ token });`;
    expect(hasStorageSync(offending)).toBe(true);
  });

  it('detects a bare storage.sync reference too', () => {
    expect(hasStorageSync('const s = storage.sync;')).toBe(true);
  });

  it('does NOT trip on chrome.storage.local (the allowed area)', () => {
    expect(hasStorageSync('await chrome.storage.local.set({ token });')).toBe(false);
  });

  it('does NOT trip on a .sync reference that only appears in a comment', () => {
    expect(hasStorageSync('// never use chrome.storage.sync for secrets\nuseLocal();')).toBe(false);
  });
});

describe('hardened sole-fetch guard has teeth (F10-FR5 — globalThis/window/self.fetch)', () => {
  it('FAILS-detects the qualified global forms the hardening added', () => {
    expect(hasAnyGlobalFetch('return globalThis.fetch(u);')).toBe(true);
    expect(hasAnyGlobalFetch('return window.fetch(u);')).toBe(true);
    expect(hasAnyGlobalFetch('return self.fetch(u);')).toBe(true);
  });

  it('still detects the bare form', () => {
    expect(hasAnyGlobalFetch('return fetch(u);')).toBe(true);
  });

  it('does NOT trip on an unrelated member .fetch (e.g. client.fetch)', () => {
    expect(hasAnyGlobalFetch('client.fetch(url)')).toBe(false);
  });

  it('ACCEPTED residual: an exotic dynamic form evades the static scan', () => {
    // Documented in docs/SECURITY-REVIEW.md §6.1 — covered by the single-adapter
    // convention + review, not by the static guard. This pins the known limit.
    expect(hasAnyGlobalFetch("const f = globalThis['fet'+'ch']; f(u);")).toBe(false);
  });
});

describe('no-remote-code guard has teeth (F10-FR4 negative control)', () => {
  it('FAILS-detects a remote <script src> (https / protocol-relative)', () => {
    expect(REMOTE_SCRIPT_RE.test('<script src="https://cdn.example.com/x.js"></script>')).toBe(
      true,
    );
    expect(REMOTE_SCRIPT_RE.test('<script src="//cdn.example.com/x.js"></script>')).toBe(true);
  });

  it('does NOT trip on a bundled relative <script src>', () => {
    expect(REMOTE_SCRIPT_RE.test('<script type="module" src="./options.ts"></script>')).toBe(false);
  });

  it('FAILS-detects a dynamic import() of a remote URL', () => {
    expect(REMOTE_IMPORT_RE.test('await import("https://cdn.example.com/x.js")')).toBe(true);
  });

  it('does NOT trip on a bundled module-specifier import()', () => {
    expect(REMOTE_IMPORT_RE.test("await import('jspdf')")).toBe(false);
  });
});
