import { describe, expect, it } from 'vitest';
import {
  basenameFromUrl,
  classifyDeliveryFailure,
  DEFAULT_PUBLIC_HOST,
  DEFAULT_PUBLIC_PROFILE,
  endpointUrl,
  findDocumentFolderId,
  isAuthFailure,
  normalizeEnvelope,
  normalizeFolderEntry,
  normalizeIsFolder,
  parseFolderList,
  privateCloudProfile,
  resolvePublicProfile,
  VIEWER_PUBLIC_PROFILE,
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

describe('resolvePublicProfile (F5-FR1 / R-8)', () => {
  it('defaults to the cloud host', () => {
    expect(DEFAULT_PUBLIC_HOST).toBe('cloud');
    expect(resolvePublicProfile()).toBe(DEFAULT_PUBLIC_PROFILE);
  });

  it('resolves the cloud host to the default profile (no extra headers)', () => {
    expect(resolvePublicProfile('cloud')).toBe(DEFAULT_PUBLIC_PROFILE);
    expect(resolvePublicProfile('cloud').headers).toEqual({});
  });

  it('resolves the viewer host to the viewer profile with the version header', () => {
    expect(resolvePublicProfile('viewer')).toBe(VIEWER_PUBLIC_PROFILE);
    expect(VIEWER_PUBLIC_PROFILE.baseUrl).toBe('https://viewer.supernote.com');
    expect(VIEWER_PUBLIC_PROFILE.headers.version).toBe('202407');
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

describe('isAuthFailure (F2-FR4)', () => {
  it('detects a transport 401 regardless of envelope', () => {
    expect(isAuthFailure(401, normalizeEnvelope({ success: true }))).toBe(true);
  });

  it('detects an E0401 envelope at HTTP 200', () => {
    expect(isAuthFailure(200, normalizeEnvelope({ success: false, errorCode: 'E0401' }))).toBe(
      true,
    );
  });

  it('detects an E0401 in a {code} envelope', () => {
    expect(isAuthFailure(200, normalizeEnvelope({ code: 401, errorCode: 'E0401' }))).toBe(true);
  });

  it('is false for a successful call', () => {
    expect(isAuthFailure(200, normalizeEnvelope({ success: true }))).toBe(false);
  });

  it('is false for a non-auth failure', () => {
    expect(isAuthFailure(200, normalizeEnvelope({ success: false, errorCode: 'E9999' }))).toBe(
      false,
    );
  });

  it('is false for a non-auth failure with no error code', () => {
    expect(isAuthFailure(500, normalizeEnvelope({ success: false }))).toBe(false);
  });
});

describe('basenameFromUrl (F5-FR2 innerName)', () => {
  it('returns the last path segment of a pre-signed S3 URL', () => {
    expect(basenameFromUrl('https://s3.amazonaws.com/bucket/path/obj-abc123')).toBe('obj-abc123');
  });

  it('ignores the query string', () => {
    expect(basenameFromUrl('https://s3.amazonaws.com/bucket/inner.pdf?X-Amz-Sig=zzz')).toBe(
      'inner.pdf',
    );
  });

  it('handles a URL with no path segments', () => {
    expect(basenameFromUrl('obj-only')).toBe('obj-only');
  });
});

describe('classifyDeliveryFailure (F5-FR4)', () => {
  it('classifies a 401 as an auth failure', () => {
    const f = classifyDeliveryFailure(401, normalizeEnvelope({ success: false }), 'fallback');
    expect(f.kind).toBe('auth');
  });

  it('classifies an E0401 envelope as an auth failure and carries the code', () => {
    const f = classifyDeliveryFailure(
      200,
      normalizeEnvelope({ success: false, errorCode: 'E0401', errorMsg: 'expired' }),
      'fallback',
    );
    expect(f.kind).toBe('auth');
    expect(f.errorCode).toBe('E0401');
    expect(f.message).toBe('expired');
  });

  it('classifies a non-auth failure as protocol with the fallback message', () => {
    const f = classifyDeliveryFailure(200, normalizeEnvelope({ success: false }), 'fallback');
    expect(f.kind).toBe('protocol');
    expect(f.message).toBe('fallback');
  });

  it('surfaces a non-auth errorCode and message when present', () => {
    const f = classifyDeliveryFailure(
      200,
      normalizeEnvelope({ success: false, errorCode: 'E9999', errorMsg: 'boom' }),
      'fallback',
    );
    expect(f.kind).toBe('protocol');
    expect(f.errorCode).toBe('E9999');
    expect(f.message).toBe('boom');
  });

  it('uses a default auth message when none is provided', () => {
    const f = classifyDeliveryFailure(401, normalizeEnvelope({ success: false }), 'fallback');
    expect(f.message).toBe('Session expired');
  });
});

describe('folder normalization (F5-FR3 / F7-FR2)', () => {
  it('normalizes a boolean isFolder (public)', () => {
    expect(normalizeIsFolder(true)).toBe(true);
    expect(normalizeIsFolder(false)).toBe(false);
  });

  it('normalizes the string "Y"/"N" isFolder (private)', () => {
    expect(normalizeIsFolder('Y')).toBe(true);
    expect(normalizeIsFolder('y')).toBe(true);
    expect(normalizeIsFolder('N')).toBe(false);
  });

  it('treats any other isFolder value as false', () => {
    expect(normalizeIsFolder(undefined)).toBe(false);
    expect(normalizeIsFolder(1)).toBe(false);
  });

  it('normalizes a folder entry with a string id', () => {
    expect(
      normalizeFolderEntry({ id: '778507258773372928', fileName: 'Document', isFolder: 'Y' }),
    ).toEqual({ id: '778507258773372928', name: 'Document', isFolder: true });
  });

  it('coerces a numeric id to a string', () => {
    expect(normalizeFolderEntry({ id: 42, fileName: 'A', isFolder: true })).toEqual({
      id: '42',
      name: 'A',
      isFolder: true,
    });
  });

  it('rejects an entry missing id or name', () => {
    expect(normalizeFolderEntry({ fileName: 'A' })).toBeUndefined();
    expect(normalizeFolderEntry({ id: '1' })).toBeUndefined();
    expect(normalizeFolderEntry('not-an-object')).toBeUndefined();
  });

  it('parses a userFileVOList, dropping malformed entries', () => {
    const folders = parseFolderList({
      userFileVOList: [
        { id: '1', fileName: 'Document', isFolder: true },
        { fileName: 'broken' },
        { id: '2', fileName: 'note.pdf', isFolder: false },
      ],
    });
    expect(folders).toEqual([
      { id: '1', name: 'Document', isFolder: true },
      { id: '2', name: 'note.pdf', isFolder: false },
    ]);
  });

  it('returns no folders when userFileVOList is absent or not an array', () => {
    expect(parseFolderList({})).toEqual([]);
    expect(parseFolderList({ userFileVOList: 'nope' })).toEqual([]);
  });

  it('finds the Document/ folder id among entries', () => {
    expect(
      findDocumentFolderId([
        { id: '9', name: 'Inbox', isFolder: true },
        { id: '7', name: 'Document', isFolder: true },
      ]),
    ).toBe('7');
  });

  it('ignores a non-folder named Document', () => {
    expect(findDocumentFolderId([{ id: '5', name: 'Document', isFolder: false }])).toBeUndefined();
  });

  it('returns undefined when there is no Document folder', () => {
    expect(findDocumentFolderId([{ id: '1', name: 'Other', isFolder: true }])).toBeUndefined();
  });
});
