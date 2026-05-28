import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COUNTRY_CODE, loginHash } from '@domain/auth';
import { md5hex } from '@shared/md5';

/** Real lowercase-hex SHA-256, mirroring the WebCrypto adapter used in prod. */
async function sha256hex(input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('loginHash (F2-FR3)', () => {
  it('computes sha256(md5(password)+randomCode) as lowercase hex (known vector)', async () => {
    const hash = await loginHash('correct horse battery staple', 'abc123', sha256hex);
    expect(hash).toBe('11881acc70795311d2472894ff70557a3b9b21a882f9da33365154a7c16d6ff9');
  });

  it('matches a second independent vector', async () => {
    const hash = await loginHash('password123', '9f8e7d', sha256hex);
    expect(hash).toBe('d5e65aa12f24f84d0acde8af588cde150e703b1606714de68788e968d018e22f');
  });

  it('feeds md5(password)+randomCode (in that order) to sha256', async () => {
    const calls: string[] = [];
    const spy = (input: string): Promise<string> => {
      calls.push(input);
      return Promise.resolve('digest');
    };
    await loginHash('pw', 'CODE', spy);
    expect(calls).toEqual([`${md5hex('pw')}CODE`]);
  });

  it('produces lowercase hex of length 64', async () => {
    const hash = await loginHash('whatever', 'code', sha256hex);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('CountryCode', () => {
  it('defaults to "1" (US) per R-7', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('1');
  });
});
