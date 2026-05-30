import { describe, expect, it } from 'vitest';
import { ORIGIN_STRIP_FILTER, stripOrigin } from '../../../src/background/origin-stripper.firefox';

// FF3-FR3/FR4 (ADR-FIREFOX-PORT D3): the Firefox webRequest Origin-strip
// fallback. `stripOrigin` is the pure, case-insensitive header transform and
// `ORIGIN_STRIP_FILTER` is its url/type scope — both mirror the Chrome DNR rule
// in `public/dnr-rules.json` and must NEVER touch the S3 PUT (I-F3). The
// listener-registration glue (`registerOriginStripper`) is coverage-excluded.

const header = (name: string, value: string): chrome.webRequest.HttpHeader => ({
  name,
  value,
});

describe('stripOrigin (FF3-FR3 case-insensitive Origin removal)', () => {
  it('removes a lowercase `origin` header', () => {
    const result = stripOrigin([header('origin', 'https://viewer.supernote.com')]);
    expect(result).toEqual([]);
  });

  it('removes a capitalized `Origin` header', () => {
    const result = stripOrigin([header('Origin', 'https://viewer.supernote.com')]);
    expect(result).toEqual([]);
  });

  it('removes an uppercase `ORIGIN` header', () => {
    const result = stripOrigin([header('ORIGIN', 'https://viewer.supernote.com')]);
    expect(result).toEqual([]);
  });

  it('returns an empty array unchanged for `[]`', () => {
    expect(stripOrigin([])).toEqual([]);
  });

  it('preserves all non-Origin headers and their order', () => {
    const headers = [
      header('Content-Type', 'application/json'),
      header('Authorization', 'Bearer token'),
      header('X-Custom', 'value'),
    ];
    expect(stripOrigin(headers)).toEqual(headers);
  });

  it('drops only the Origin header when mixed with other headers', () => {
    const headers = [
      header('Content-Type', 'application/json'),
      header('Origin', 'https://viewer.supernote.com'),
      header('Authorization', 'Bearer token'),
    ];
    expect(stripOrigin(headers)).toEqual([
      header('Content-Type', 'application/json'),
      header('Authorization', 'Bearer token'),
    ]);
  });
});

describe('ORIGIN_STRIP_FILTER (FF3-FR4 / I-F3 scope parity with DNR rule)', () => {
  it('scopes urls to exactly the two viewer/cloud Supernote patterns', () => {
    expect(ORIGIN_STRIP_FILTER.urls).toEqual([
      'https://viewer.supernote.com/*',
      'https://cloud.supernote.com/*',
    ]);
  });

  it('never includes an amazonaws S3 url — the pre-signed PUT is untouched (I-F3)', () => {
    for (const url of ORIGIN_STRIP_FILTER.urls ?? []) {
      expect(url).not.toContain('amazonaws');
    }
  });

  it('restricts types to `xmlhttprequest` only (parity with the DNR rule, not widened to `other`)', () => {
    expect(ORIGIN_STRIP_FILTER.types).toEqual(['xmlhttprequest']);
  });
});
