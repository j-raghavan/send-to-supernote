import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ConnectPrivateCloudDeps,
  connectPrivateCloud,
} from '../../../src/auth/connect-private-cloud';
import { LOGIN_PATH, NONCE_PATH } from '../../../src/auth/login-routine';
import { StorageKeys } from '@shared/storage-keys';
import { FakeHttpClient } from '../../fakes/fake-http-client';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeRandomSource } from '../../fakes/fake-random-source';

async function sha256hex(input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('connectPrivateCloud (F7-FR3 / F8-FR1)', () => {
  let http: FakeHttpClient;
  let kv: FakeKeyValueStore;
  let deps: ConnectPrivateCloudDeps;

  beforeEach(() => {
    http = new FakeHttpClient();
    kv = new FakeKeyValueStore();
    deps = { http, sha256hex, random: new FakeRandomSource(), store: kv };
  });

  it('connects against the base URL and persists only the JWT + baseUrl + account', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'jwt-xyz' } });

    const result = await connectPrivateCloud(deps, {
      baseUrl: 'http://192.168.1.5:8080',
      account: 'me@x.com',
      password: 'pw',
    });

    expect(result.ok).toBe(true);
    expect(await kv.get(StorageKeys.privateToken)).toBe('jwt-xyz');
    expect(await kv.get(StorageKeys.privateBaseUrl)).toBe('http://192.168.1.5:8080');
    expect(await kv.get(StorageKeys.privateAccount)).toBe('me@x.com');
    // targets the /api-prefixed endpoints on the user's server
    expect(http.urls[0]).toBe('http://192.168.1.5:8080/api/official/user/query/random/code');
  });

  it('never writes the password (D-2)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'jwt' } });
    await connectPrivateCloud(deps, {
      baseUrl: 'https://pc.home.lan',
      account: 'me@x.com',
      password: 'TOPSECRET',
    });
    expect(kv.snapshot()).not.toContain('TOPSECRET');
  });

  it('stores no token when credentials are invalid', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: false, errorCode: 'E0401' } });
    const result = await connectPrivateCloud(deps, {
      baseUrl: 'https://pc.home.lan',
      account: 'me@x.com',
      password: 'wrong',
    });
    expect(result.ok).toBe(false);
    expect(await kv.get(StorageKeys.privateToken)).toBeUndefined();
  });

  it('reuses the existing equipment id from the public account', async () => {
    await kv.set(StorageKeys.equipment, 'shared-eq');
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'jwt' } });
    await connectPrivateCloud(deps, {
      baseUrl: 'https://pc.home.lan',
      account: 'me@x.com',
      password: 'pw',
    });
    const loginBody = http.requests[1]!.body as Record<string, unknown>;
    expect(loginBody.equipment).toBe('shared-eq');
  });

  it('passes a custom countryCode through to login (R-7)', async () => {
    http
      .on(NONCE_PATH, { status: 200, json: { success: true, randomCode: 'C' } })
      .on(LOGIN_PATH, { status: 200, json: { success: true, token: 'jwt' } });
    await connectPrivateCloud(deps, {
      baseUrl: 'https://pc.home.lan',
      account: 'me@x.com',
      password: 'pw',
      countryCode: '44',
    });
    const nonceBody = http.requests[0]!.body as Record<string, unknown>;
    expect(nonceBody.countryCode).toBe('44');
  });
});
