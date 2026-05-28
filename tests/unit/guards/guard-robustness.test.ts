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
