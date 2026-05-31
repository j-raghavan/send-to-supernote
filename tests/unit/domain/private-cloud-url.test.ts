import { describe, expect, it } from 'vitest';
import {
  HTTP_OVER_LAN_WARNING,
  httpWarningFor,
  privateCloudNetworkErrorHint,
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
