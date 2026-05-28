import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ConnectDeps, connectAccount } from '../../../src/auth/connect-account';
import { LOGIN_PATH, NONCE_PATH } from '../../../src/auth/login-routine';
import { TokenStore } from '../../../src/auth/token-store';
import { StorageKeys } from '@shared/storage-keys';
import { FakeHttpClient } from '../../fakes/fake-http-client';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeRandomSource } from '../../fakes/fake-random-source';

async function sha256hex(input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('connectAccount (F2-FR1)', () => {
  let http: FakeHttpClient;
  let kv: FakeKeyValueStore;
  let deps: ConnectDeps;

  beforeEach(() => {
    http = new FakeHttpClient();
    kv = new FakeKeyValueStore();
    deps = { http, sha256hex, random: new FakeRandomSource(), tokens: new TokenStore(kv) };
  });

  it('connects, persists only the token/account/equipment (F2-AC1)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'tok-9' } });

    const result = await connectAccount(deps, { account: 'me@x.com', password: 'pw' });

    expect(result.ok).toBe(true);
    expect(await kv.get(StorageKeys.token)).toBe('tok-9');
    expect(await kv.get(StorageKeys.account)).toBe('me@x.com');
    expect(await kv.get(StorageKeys.equipment)).toBeDefined();
  });

  it('never writes the password to storage (F2-AC2)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'tok' } });

    await connectAccount(deps, { account: 'me@x.com', password: 'TOPSECRET' });

    expect(kv.snapshot()).not.toContain('TOPSECRET');
    expect(await kv.keys()).not.toContain('supernote.password');
  });

  it('stores no token when credentials are invalid (F2-AC3)', async () => {
    http.on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } }).on(LOGIN_PATH, {
      status: 200,
      json: { success: false, errorCode: 'E0401', errorMsg: 'bad' },
    });

    const result = await connectAccount(deps, { account: 'me@x.com', password: 'wrong' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth-failed');
    }
    expect(await kv.get(StorageKeys.token)).toBeUndefined();
  });

  it('reuses an existing equipment id across reconnects (stable client identity)', async () => {
    await deps.tokens.save({ token: 'old', account: 'me@x.com', equipment: 'stable-eq' });
    await deps.tokens.clearToken();
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'new-tok' } });

    const result = await connectAccount(deps, { account: 'me@x.com', password: 'pw' });

    expect(result.ok && result.value.equipment).toBe('stable-eq');
    const loginBody = http.requests[1]!.body as Record<string, unknown>;
    expect(loginBody.equipment).toBe('stable-eq');
  });

  it('passes a custom countryCode through to login (R-7)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'tok' } });

    await connectAccount(deps, { account: 'me@x.com', password: 'pw', countryCode: '44' });

    const nonceBody = http.requests[0]!.body as Record<string, unknown>;
    expect(nonceBody.countryCode).toBe('44');
  });
});
