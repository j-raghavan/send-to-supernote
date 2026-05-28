import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLIC_PROFILE,
  endpointUrl,
  normalizeEnvelope,
  privateCloudProfile,
} from '@domain/delivery';

describe('ApiProfile (R-8 / ADR-0003)', () => {
  it('the default public profile targets cloud.supernote.com with no prefix', () => {
    expect(DEFAULT_PUBLIC_PROFILE.baseUrl).toBe('https://cloud.supernote.com');
    expect(DEFAULT_PUBLIC_PROFILE.pathPrefix).toBe('');
    expect(DEFAULT_PUBLIC_PROFILE.usesCodeEnvelope).toBe(false);
  });

  it('builds a private cloud profile with the /api prefix and code envelope', () => {
    const profile = privateCloudProfile('http://192.168.50.168:8080/');
    expect(profile.baseUrl).toBe('http://192.168.50.168:8080');
    expect(profile.pathPrefix).toBe('/api');
    expect(profile.usesCodeEnvelope).toBe(true);
  });
});

describe('endpointUrl', () => {
  it('joins base + path for the public profile', () => {
    expect(endpointUrl(DEFAULT_PUBLIC_PROFILE, '/file/upload/apply')).toBe(
      'https://cloud.supernote.com/file/upload/apply',
    );
  });

  it('prefixes /api for the private profile', () => {
    const profile = privateCloudProfile('http://host:8080');
    expect(endpointUrl(profile, '/file/upload/apply')).toBe(
      'http://host:8080/api/file/upload/apply',
    );
  });

  it('tolerates a path without a leading slash', () => {
    expect(endpointUrl(DEFAULT_PUBLIC_PROFILE, 'file/list/query')).toBe(
      'https://cloud.supernote.com/file/list/query',
    );
  });

  it('strips a trailing slash on the base url', () => {
    const profile = { ...DEFAULT_PUBLIC_PROFILE, baseUrl: 'https://cloud.supernote.com/' };
    expect(endpointUrl(profile, '/x')).toBe('https://cloud.supernote.com/x');
  });
});

describe('normalizeEnvelope', () => {
  it('reads a {success:true, ...} envelope (public)', () => {
    const env = normalizeEnvelope({ success: true, token: 'abc' });
    expect(env.success).toBe(true);
    expect(env.payload.token).toBe('abc');
  });

  it('reads a {success:false, errorCode} envelope and surfaces the code', () => {
    const env = normalizeEnvelope({ success: false, errorCode: 'E0401', errorMsg: 'expired' });
    expect(env.success).toBe(false);
    expect(env.errorCode).toBe('E0401');
    expect(env.errorMsg).toBe('expired');
  });

  it('reads a {code:0, data} envelope (private list) as success with data payload', () => {
    const env = normalizeEnvelope({ code: 0, data: { userFileVOList: [] } });
    expect(env.success).toBe(true);
    expect(env.payload).toEqual({ userFileVOList: [] });
  });

  it('treats code 200 as success', () => {
    const env = normalizeEnvelope({ code: 200, data: { x: 1 } });
    expect(env.success).toBe(true);
  });

  it('treats a non-OK code as failure and surfaces errorCode + msg', () => {
    const env = normalizeEnvelope({ code: 401, errorCode: 'E0401', msg: 'nope' });
    expect(env.success).toBe(false);
    expect(env.errorCode).toBe('E0401');
    expect(env.errorMsg).toBe('nope');
  });

  it('defaults to failure for a non-object or shapeless body', () => {
    expect(normalizeEnvelope(undefined).success).toBe(false);
    expect(normalizeEnvelope('oops').success).toBe(false);
    expect(normalizeEnvelope(null).payload).toEqual({});
  });

  it('omits errorCode/errorMsg when absent', () => {
    const env = normalizeEnvelope({ success: true });
    expect(env.errorCode).toBeUndefined();
    expect(env.errorMsg).toBeUndefined();
  });

  it('falls back to errorMsg when a {code} envelope has no msg field', () => {
    const env = normalizeEnvelope({ code: 500, errorMsg: 'server error' });
    expect(env.success).toBe(false);
    expect(env.errorMsg).toBe('server error');
  });

  it('omits errorMsg when a failing {code} envelope has neither msg nor errorMsg', () => {
    const env = normalizeEnvelope({ code: 500 });
    expect(env.success).toBe(false);
    expect(env.errorMsg).toBeUndefined();
  });
});
