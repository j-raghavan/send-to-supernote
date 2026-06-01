import { describe, expect, it } from 'vitest';
import {
  HTTP_OVER_LAN_WARNING,
  httpWarningFor,
  privateCloudNetworkErrorHint,
  resolveUploadUrl,
  validateBaseUrl,
} from '@domain/private-cloud-url';

describe('validateBaseUrl (F7-FR3 / F8-FR1)', () => {
  it('accepts an HTTPS reverse-proxy host and returns the origin', () => {
    const result = validateBaseUrl('https://supernote.home.lan/some/path');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.baseUrl).toBe('https://supernote.home.lan');
      expect(result.value.isHttp).toBe(false);
    }
  });

  it('accepts a plain-HTTP LAN host:port and flags it as HTTP', () => {
    const result = validateBaseUrl('http://192.168.50.168:8080');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.baseUrl).toBe('http://192.168.50.168:8080');
      expect(result.value.isHttp).toBe(true);
    }
  });

  it('trims whitespace and strips a trailing path', () => {
    const result = validateBaseUrl('  http://host:8080/api/  ');
    expect(result.ok && result.value.baseUrl).toBe('http://host:8080');
  });

  it('rejects an empty value', () => {
    const result = validateBaseUrl('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('empty');
    }
  });

  it('rejects a malformed URL', () => {
    const result = validateBaseUrl('not a url');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('malformed');
    }
  });

  it('rejects a non-http(s) protocol', () => {
    const result = validateBaseUrl('ftp://host:21');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('unsupported-protocol');
    }
  });
});

describe('httpWarningFor (R-10 / F8-FR7)', () => {
  it('warns for a plain-HTTP base URL', () => {
    expect(httpWarningFor({ baseUrl: 'http://host:8080', isHttp: true })).toBe(
      HTTP_OVER_LAN_WARNING,
    );
  });

  it('does not warn for an HTTPS base URL', () => {
    expect(httpWarningFor({ baseUrl: 'https://host', isHttp: false })).toBeUndefined();
  });
});

describe('privateCloudNetworkErrorHint (F8 connect failure guidance)', () => {
  it('leads with reachability, then appends cert + http-port notes for an HTTPS URL', () => {
    const hint = privateCloudNetworkErrorHint('https://192.168.2.164:8443');
    // reachability first (does not assume a cert problem)
    expect(hint.toLowerCase()).toContain('reach');
    expect(hint.toLowerCase()).toMatch(/check the server is running/);
    // cert guidance appended (not foregrounded)
    expect(hint.toLowerCase()).toContain('certificate');
    expect(hint.toLowerCase()).toContain('self-signed');
    // http fallback substitutes the ACTUAL host from baseUrl, on port 19072
    expect(hint).toContain('http://192.168.2.164:19072');
  });

  it('gives ONLY the generic reachability hint for an http:// URL (no cert copy)', () => {
    const hint = privateCloudNetworkErrorHint('http://192.168.2.164:19072');
    expect(hint).toContain('192.168.2.164:19072');
    expect(hint.toLowerCase()).toContain('reach');
    expect(hint.toLowerCase()).not.toContain('certificate');
  });

  it('falls back to a placeholder host when the URL cannot be parsed', () => {
    const hint = privateCloudNetworkErrorHint('https://');
    expect(hint).toContain('http://<your-server-ip>:19072');
  });
});

describe('resolveUploadUrl (F8-FR2 / D-3 reverse-proxy safety)', () => {
  const BASE = 'http://192.168.1.5:8080';

  it('re-bases a relative apply path onto the configured base', () => {
    expect(resolveUploadUrl(BASE, '/api/oss/upload')).toBe(`${BASE}/api/oss/upload`);
  });

  it('adds a leading slash to a relative apply path without one', () => {
    expect(resolveUploadUrl(BASE, 'api/oss/upload')).toBe(`${BASE}/api/oss/upload`);
  });

  it('preserves the path AND query of the apply URL', () => {
    expect(resolveUploadUrl(BASE, '/api/oss/upload?token=abc&exp=9')).toBe(
      `${BASE}/api/oss/upload?token=abc&exp=9`,
    );
  });

  it('keeps a same-host absolute apply URL pointing at the configured base', () => {
    expect(resolveUploadUrl(BASE, `${BASE}/api/oss/upload`)).toBe(`${BASE}/api/oss/upload`);
  });

  it('DISCARDS a foreign/internal host the apply response names, keeping only path+query', () => {
    // A reverse-proxied server may return an internal origin; the file POST (which
    // carries the JWT) must still go ONLY to the user-configured base.
    const resolved = resolveUploadUrl(BASE, 'http://10.0.0.9:9000/api/oss/upload?token=secret');
    expect(resolved).toBe(`${BASE}/api/oss/upload?token=secret`);
    expect(new URL(resolved!).host).toBe('192.168.1.5:8080');
  });

  it('strips a trailing slash from the base before re-basing', () => {
    expect(resolveUploadUrl(`${BASE}/`, '/api/oss/upload')).toBe(`${BASE}/api/oss/upload`);
  });

  it('returns undefined for a malformed absolute apply URL (diagnosable, not coerced)', () => {
    // `http://` alone is a malformed absolute URL: the URL constructor throws even
    // with a base. We reject it so the caller can surface "malformed upload URL"
    // rather than POST to a guessed path that would 404.
    expect(resolveUploadUrl(BASE, 'http://')).toBeUndefined();
  });

  it('rejects a non-http(s) absolute apply URL at the boundary (javascript:/data:/file:)', () => {
    expect(resolveUploadUrl(BASE, 'javascript:alert(1)')).toBeUndefined();
    expect(resolveUploadUrl(BASE, 'data:text/html,hi')).toBeUndefined();
    expect(resolveUploadUrl(BASE, 'file:///etc/passwd')).toBeUndefined();
  });

  it('resolves against an HTTPS base (relative path inherits https)', () => {
    expect(resolveUploadUrl('https://nas.local', '/api/oss/upload?t=1')).toBe(
      'https://nas.local/api/oss/upload?t=1',
    );
  });
});
