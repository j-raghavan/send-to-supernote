import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_COOKIE,
  CLOUD_WEB_URL,
  captureCloudToken,
  isSupernoteCookieDomain,
  resolveConnectStoreIds,
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
// Far enough ahead that the un-injected `Date.now()` path (the "defaults the
// clock" test) stays valid for years — a +1-day offset from the fixed NOW_MS
// elapsed in real time on 2026-05-29 and broke that test. Still > NOW_MS, so
// the injected-clock assertions are unaffected.
const FUTURE_EXP = Math.floor(NOW_MS / 1000) + 10 * 365 * 86_400; // +10 years
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

  it('finds the cookie when Supernote set it on viewer.supernote.com (domain match)', async () => {
    const token = jwt({ exp: FUTURE_EXP, userId: '7', equipmentNo: 'WEB' });
    cookies.set('https://viewer.supernote.com', ACCESS_TOKEN_COOKIE, token);

    const result = await captureCloudToken({ cookies, tokens, now });

    expect(result.ok).toBe(true);
    expect(await tokens.getToken()).toBe(token);
  });

  it('reads a non-default cookie store (Incognito/container sign-in)', async () => {
    const token = jwt({ exp: FUTURE_EXP, userId: '5' });
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, token, 'firefox-private');

    // Default-store search misses it; searching the tab's store finds it.
    expect((await captureCloudToken({ cookies, tokens, now })).ok).toBe(false);
    const result = await captureCloudToken({
      cookies,
      tokens,
      now,
      storeIds: ['firefox-private'],
    });

    expect(result.ok).toBe(true);
    expect(await tokens.getToken()).toBe(token);
  });

  it('de-duplicates the same cookie surfaced from several stores', async () => {
    const token = jwt({ exp: FUTURE_EXP, userId: '8' });
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, token); // default store
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, token, 'store-b');

    const result = await captureCloudToken({
      cookies,
      tokens,
      now,
      storeIds: [undefined, 'store-b'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.userId).toBe('8');
  });

  it('picks the freshest valid token when several candidates exist', async () => {
    const mid = jwt({ exp: FUTURE_EXP + 500, userId: 'mid' });
    const later = jwt({ exp: FUTURE_EXP + 1000, userId: 'later' });
    const sooner = jwt({ exp: FUTURE_EXP, userId: 'sooner' });
    // Search order is [default, store-b, store-c] -> candidates [mid, later, sooner],
    // so the running-best both advances (mid -> later) and holds (later vs sooner).
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, mid);
    cookies.set('https://viewer.supernote.com', ACCESS_TOKEN_COOKIE, later, 'store-b');
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, sooner, 'store-c');

    const result = await captureCloudToken({
      cookies,
      tokens,
      now,
      storeIds: [undefined, 'store-b', 'store-c'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.userId).toBe('later');
  });

  it('treats an opaque (no-exp) token as longest-lived among candidates', async () => {
    // opaque tokens have no `exp`, so they rank as never-expiring; with the
    // earliest-wins tie-break the first opaque seen is kept over a finite JWT.
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, 'opaque-A');
    cookies.set(
      'https://viewer.supernote.com',
      ACCESS_TOKEN_COOKIE,
      jwt({ exp: FUTURE_EXP }),
      'store-b',
    );
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, 'opaque-B', 'store-c');

    const result = await captureCloudToken({
      cookies,
      tokens,
      now,
      storeIds: [undefined, 'store-b', 'store-c'],
    });

    expect(result.ok).toBe(true);
    expect(await tokens.getToken()).toBe('opaque-A');
  });

  it('returns expired when every candidate across stores is expired', async () => {
    cookies.set(CLOUD_WEB_URL, ACCESS_TOKEN_COOKIE, jwt({ exp: PAST_EXP, userId: '1' }));
    cookies.set(
      CLOUD_WEB_URL,
      ACCESS_TOKEN_COOKIE,
      jwt({ exp: PAST_EXP - 50, userId: '2' }),
      'store-b',
    );

    const result = await captureCloudToken({
      cookies,
      tokens,
      now,
      storeIds: [undefined, 'store-b'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('expired');
    expect(await tokens.getToken()).toBeUndefined();
  });
});

describe('isSupernoteCookieDomain', () => {
  it.each([
    ['supernote.com', true],
    ['cloud.supernote.com', true],
    ['viewer.supernote.com', true],
    ['.supernote.com', true], // chrome.cookies reports a leading dot for domain cookies
    ['evil-supernote.com', false], // lookalike — must NOT match a loose includes()
    ['notsupernote.com', false],
    ['supernote.com.evil.com', false], // suffix attack
    ['example.com', false],
  ])('%s -> %s', (domain, expected) => {
    expect(isSupernoteCookieDomain(domain)).toBe(expected);
  });
});

describe('resolveConnectStoreIds', () => {
  let cookies: FakeCookieReader;

  beforeEach(() => {
    cookies = new FakeCookieReader();
  });

  it('uses the recorded store (+default) without consulting the tab', async () => {
    // No tab->store mapping seeded, so a fallback to storeIdForTab would yield
    // undefined; getting [recorded, undefined] proves the recorded id was used.
    const result = await resolveConnectStoreIds(cookies, 7, 'firefox-container-1');
    expect(result).toEqual(['firefox-container-1', undefined]);
  });

  it('resolves the store from the tab when none was recorded (Chrome)', async () => {
    cookies.setTabStore(7, 'store-incognito');
    const result = await resolveConnectStoreIds(cookies, 7);
    expect(result).toEqual(['store-incognito', undefined]);
  });

  it('falls back to scanning every readable store when the tab store is unknown', async () => {
    cookies.set('https://cloud.supernote.com', ACCESS_TOKEN_COOKIE, 'x', 'store-b');
    const result = await resolveConnectStoreIds(cookies, 7);
    // No recorded id, tab not mapped -> listStoreIds (default + seeded).
    expect(result).toEqual(['0', 'store-b']);
  });
});
