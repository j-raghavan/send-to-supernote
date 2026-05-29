import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_COOKIE,
  CLOUD_WEB_URL,
  captureCloudToken,
} from '../../../src/auth/cloud-session';
import { decodeAccessToken } from '@domain/auth';
import { TokenStore } from '../../../src/auth/token-store';
import { StorageKeys } from '@shared/storage-keys';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeCookieReader } from '../../fakes/fake-cookie-reader';

/** Build a (signature-less) JWT whose payload encodes the given claims. */
function jwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

const NOW_MS = 1_780_000_000_000;
const FUTURE_EXP = Math.floor(NOW_MS / 1000) + 86_400; // +1 day
const PAST_EXP = Math.floor(NOW_MS / 1000) - 10;

describe('decodeAccessToken', () => {
  it('decodes exp / userId / equipmentNo from a JWT payload', () => {
    const claims = decodeAccessToken(jwt({ exp: FUTURE_EXP, userId: '42', equipmentNo: 'WEB' }));
    expect(claims).toEqual({ exp: FUTURE_EXP, userId: '42', equipmentNo: 'WEB' });
  });

  it('returns undefined for a non-JWT string', () => {
    expect(decodeAccessToken('not-a-jwt')).toBeUndefined();
  });

  it('returns undefined when the payload is not valid base64 JSON', () => {
    expect(decodeAccessToken('a.@@@notbase64@@@.c')).toBeUndefined();
  });

  it('ignores claims of the wrong type', () => {
    expect(decodeAccessToken(jwt({ exp: 'soon', userId: 7 }))).toEqual({});
  });

  it('returns undefined when the payload is valid JSON but not an object', () => {
    const payload = Buffer.from('123').toString('base64url');
    expect(decodeAccessToken(`h.${payload}.s`)).toBeUndefined();
  });
});

describe('captureCloudToken', () => {
  let kv: FakeKeyValueStore;
  let cookies: FakeCookieReader;
  let tokens: TokenStore;
  const now = (): number => NOW_MS;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    cookies = new FakeCookieReader();
    tokens = new TokenStore(kv);
  });

  it('fails with no-token when the session cookie is absent', async () => {
    const result = await captureCloudToken({ cookies, tokens, now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no-token');
    expect(await tokens.getToken()).toBeUndefined();
  });

  it('persists the token + equipment and returns userId for a valid cookie', async () => {
    const token = jwt({ exp: FUTURE_EXP, userId: '1142864880978219008', equipmentNo: 'WEB' });
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, token);

    const result = await captureCloudToken({ cookies, tokens, now });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.userId).toBe('1142864880978219008');
    expect(await tokens.getToken()).toBe(token);
    expect(await tokens.getEquipment()).toBe('WEB');
    // No email is available from the cookie flow, so account stays unset.
    expect(await tokens.getAccount()).toBeUndefined();
  });

  it('rejects an already-expired token without storing it', async () => {
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, jwt({ exp: PAST_EXP, userId: '9' }));

    const result = await captureCloudToken({ cookies, tokens, now });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('expired');
    expect(await tokens.getToken()).toBeUndefined();
  });

  it('stores an opaque (non-JWT) cookie with the default equipment', async () => {
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, 'opaque-token');

    const result = await captureCloudToken({ cookies, tokens, now });

    expect(result.ok).toBe(true);
    expect(await tokens.getToken()).toBe('opaque-token');
    expect(await tokens.getEquipment()).toBe('WEB');
  });

  it('defaults the clock to Date.now when none is injected', async () => {
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, jwt({ exp: FUTURE_EXP }));
    const result = await captureCloudToken({ cookies, tokens });
    expect(result.ok).toBe(true);
  });

  it('reads the cookie scoped to the cloud.supernote.com origin', async () => {
    cookies.set('https://example.com', ACCESS_TOKEN_COOKIE, jwt({ exp: FUTURE_EXP }));
    const result = await captureCloudToken({ cookies, tokens, now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no-token');
  });

  it('clears with the public-cloud keys (token survives a round-trip)', async () => {
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, jwt({ exp: FUTURE_EXP }));
    await captureCloudToken({ cookies, tokens, now });
    expect(await kv.get(StorageKeys.token)).toBeDefined();
  });
});
