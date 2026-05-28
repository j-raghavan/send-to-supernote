import { describe, expect, it } from 'vitest';
import { encodeRequest } from '@domain/http-encoding';

describe('encodeRequest (F5)', () => {
  it('serializes a plain object to JSON and defaults the content type', () => {
    const { headers, body } = encodeRequest({ a: 1 });
    expect(body).toBe('{"a":1}');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('does not override a caller-supplied content type (case-insensitive)', () => {
    const { headers, body } = encodeRequest(
      { a: 1 },
      { 'content-type': 'application/vnd.custom+json' },
    );
    expect(body).toBe('{"a":1}');
    expect(headers['content-type']).toBe('application/vnd.custom+json');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('passes Uint8Array bytes through unchanged (S3 PUT) without forcing JSON', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { headers, body } = encodeRequest(bytes, { 'Content-Type': 'application/pdf' });
    expect(body).toBe(bytes);
    expect(headers['Content-Type']).toBe('application/pdf');
  });

  it('passes an ArrayBuffer through unchanged', () => {
    const buf = new ArrayBuffer(4);
    expect(encodeRequest(buf).body).toBe(buf);
  });

  it('passes FormData through unchanged (multipart, never forcing a content type)', () => {
    const form = new FormData();
    form.append('file', 'x');
    const { headers, body } = encodeRequest(form);
    expect(body).toBe(form);
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('passes a pre-serialized string through unchanged', () => {
    expect(encodeRequest('already-a-string').body).toBe('already-a-string');
  });

  it('encodes an undefined or null body as no body', () => {
    expect(encodeRequest(undefined).body).toBeUndefined();
    expect(encodeRequest(null).body).toBeUndefined();
  });

  it('preserves caller headers when there is no body', () => {
    expect(encodeRequest(undefined, { 'x-access-token': 't' }).headers).toEqual({
      'x-access-token': 't',
    });
  });
});
