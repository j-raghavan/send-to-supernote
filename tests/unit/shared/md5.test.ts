import { describe, expect, it } from 'vitest';
import { md5hex, md5hexBytes } from '@shared/md5';

describe('md5hex (RFC 1321 known vectors)', () => {
  it('hashes the empty string', () => {
    expect(md5hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('hashes "abc"', () => {
    expect(md5hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('hashes "hello"', () => {
    expect(md5hex('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('hashes a sentence that crosses a 64-byte block boundary', () => {
    expect(md5hex('The quick brown fox jumps over the lazy dog')).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    );
  });

  it('hashes a long input spanning multiple blocks', () => {
    // 1000 'a' chars — exercises multi-chunk processing.
    const digest = md5hex('a'.repeat(1000));
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    // ground truth from the standard algorithm
    expect(digest).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
  });

  it('is lowercase hex of length 32', () => {
    expect(md5hex('Mixed CASE 123')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('md5hexBytes', () => {
  it('hashes raw bytes consistently with the UTF-8 string form', () => {
    const bytes = new TextEncoder().encode('abc');
    expect(md5hexBytes(bytes)).toBe(md5hex('abc'));
  });

  it('hashes empty bytes', () => {
    expect(md5hexBytes(new Uint8Array(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
});
